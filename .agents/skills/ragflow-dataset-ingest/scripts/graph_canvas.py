#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 DSH 画布用的 RAGFlow 知识图谱交互式 HTML（自包含，无外部依赖）。

用法:
  python3 scripts/graph_canvas.py DATASET_ID [--top N] [--out FILE]
  环境变量: RAGFLOW_API_URL, RAGFLOW_API_KEY（与其他脚本一致）

输出自包含 HTML：力导向布局、节点按实体类型着色、按连接数定大小、
可拖拽/缩放/悬停高亮邻居。stdout 输出 HTML（或 --out 写文件），
配合 DSH canvas 工具 (op=write, kind=html) 在右侧画布展示。
"""
import argparse
import json
import sys
import urllib.request

from common import RAGFLOW_API_URL_ENV, RAGFLOW_API_KEY_ENV, configure_stdio_utf8
import os


def fetch_graph(base_url: str, api_key: str, dataset_id: str) -> dict:
    req = urllib.request.Request(
        f"{base_url}/api/v1/datasets/{dataset_id}/knowledge_graph",
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if payload.get("code") != 0:
        raise SystemExit(f"API error: {payload.get('message')}")
    return (payload.get("data") or {}).get("graph") or {}


def normalize(graph: dict, top: int):
    nodes_raw = graph.get("nodes") or []
    edges_raw = graph.get("edges") or []
    nodes = []
    for n in nodes_raw:
        name = n.get("entity_name") or n.get("entity") or n.get("name") or n.get("id")
        if not name:
            continue
        nodes.append({
            "name": str(name),
            "type": str(n.get("entity_type") or n.get("type") or "unknown").upper(),
            "desc": str(n.get("description") or "")[:300],
        })
    degree = {n["name"]: 0 for n in nodes}
    seen = set(n["name"] for n in nodes)
    edges = []
    for e in edges_raw:
        f = e.get("source") or e.get("src_entity") or e.get("from")
        t = e.get("target") or e.get("dst_entity") or e.get("to")
        if isinstance(f, list): f = f[0] if f else None
        if isinstance(t, list): t = t[0] if t else None
        if not f or not t or f not in seen or t not in seen:
            continue
        rel = e.get("relationship") or e.get("edge") or e.get("description") or ""
        edges.append({"f": str(f), "t": str(t), "rel": str(rel)[:60]})
        degree[f] += 1
        degree[t] += 1
    for n in nodes:
        n["deg"] = degree.get(n["name"], 0)
    nodes.sort(key=lambda n: -n["deg"])
    keep = set(n["name"] for n in nodes[:top])
    edges = [e for e in edges if e["f"] in keep and e["t"] in keep]
    return nodes[:top], edges


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<style>
  html,body{{margin:0;height:100%;background:#0f1419;color:#d8dee6;
    font:13px/1.5 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;overflow:hidden}}
  #bar{{position:fixed;top:10px;left:12px;z-index:2;background:rgba(20,26,33,.92);
    border:1px solid #2a3442;border-radius:10px;padding:10px 14px;max-width:340px}}
  #bar h1{{font-size:14px;margin:0 0 4px}}
  #bar .sub{{color:#7d8b9a;font-size:11px}}
  .lg{{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}}
  .lg span{{font-size:11px;color:#aeb9c6;display:flex;align-items:center;gap:4px}}
  .lg i{{width:9px;height:9px;border-radius:50%;display:inline-block}}
  #tip{{position:fixed;pointer-events:none;background:#1b2330;border:1px solid #345;
    border-radius:8px;padding:8px 10px;max-width:280px;display:none;z-index:3;font-size:12px}}
  #tip b{{color:#fff}} #tip .t{{color:#7d8b9a;font-size:10px}}
</style>
</head>
<body>
<div id="bar">
  <h1>{title} · 知识图谱</h1>
  <div class="sub">{nstat} 个实体 · {estat} 条关系 · 滚轮缩放 / 拖拽节点 / 悬停看详情</div>
  <div class="lg">{legend}</div>
</div>
<canvas id="cv"></canvas>
<div id="tip"></div>
<script>
const NODES={nodes};const EDGES={edges};
const COLORS={{EQUIPMENT:'#4fc3f7',MATERIAL:'#ffb74d',PROCESS_STEP:'#81c784',ROLE:'#ba68c8',
  HAZARD:'#e57373',DEPARTMENT:'#90a4ae',LOCATION:'#4db6ac',TOOL:'#fff176',
  DOCUMENT:'#b0bec5',CONCEPT:'#64b5f6',PACKAGE:'#ce93d8',MODULE:'#aed581',
  TOOL2:'#fff176',API:'#f06292',COMMAND:'#ffd54f',EVENT:'#a1887f',
  CATEGORY:'#90caf9',PERSON:'#f48fb1',ORGANIZATION:'#a78bfa',UNKNOWN:'#78909c'}};
const color=t=>COLORS[t]||'#78909c';
const cv=document.getElementById('cv'),ctx=cv.getContext('2d'),tip=document.getElementById('tip');
let W,H,DPR;
function resize(){{DPR=window.devicePixelRatio||1;W=innerWidth;H=innerHeight;
  cv.width=W*DPR;cv.height=H*DPR;cv.style.width=W+'px';cv.style.height=H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);}}
addEventListener('resize',resize);resize();
const maxDeg=Math.max(1,...NODES.map(n=>n.deg));
NODES.forEach((n,i)=>{{const a=2*Math.PI*i/NODES.length,r=Math.min(W,H)*.32;
  n.x=W/2+r*Math.cos(a);n.y=H/2+r*Math.sin(a);n.vx=0;n.vy=0;}});
let scale=1,panX=0,panY=0,hover=null,drag=null;
const pos=n=>{{n.px=(n.x-W/2)*scale+W/2+panX;n.py=(n.y-H/2)*scale+H/2+panY;
  n.pr=(4+9*Math.sqrt(n.deg/maxDeg))*Math.min(1.2,scale);}};
function sim(){{for(let it=0;it<3;it++){{
  for(let i=0;i<NODES.length;i++)for(let j=i+1;j<NODES.length;j++){{
    const a=NODES[i],b=NODES[j];let dx=b.x-a.x,dy=b.y-a.y;
    let d2=dx*dx+dy*dy;if(d2<1){{dx=Math.random();dy=Math.random();d2=1;}}
    const f=1600/d2;const d=Math.sqrt(d2);
    a.vx-=f*dx/d;a.vy-=f*dy/d;b.vx+=f*dx/d;b.vy+=f*dy/d;}}
  for(const e of EDGES){{const a=NODES.find(n=>n.name===e.f),b=NODES.find(n=>n.name===e.t);
    if(!a||!b)continue;let dx=b.x-a.x,dy=b.y-a.y;const d=Math.sqrt(dx*dx+dy*dy)||1;
    const f=(d-110)*.004;a.vx+=f*dx/d;a.vy+=f*dy/d;b.vx-=f*dx/d;b.vy-=f*dy/d;}}
  for(const n of NODES){{n.vx+=(W/2-n.x)*.0006;n.vy+=(H/2-n.y)*.0006;
    n.vx*=.82;n.vy*=.82;n.x+=n.vx;n.y+=n.vy;}}}}
  requestAnimationFrame(sim);}}
function draw(){{ctx.clearRect(0,0,W,H);
  const hN=hover?new Set([hover,...EDGES.filter(e=>e.f===hover.name||e.t===hover.name)
    .flatMap(e=>[e.f,e.t]))):null;
  for(const e of EDGES){{const a=NODES.find(n=>n.name===e.f),b=NODES.find(n=>n.name===e.t);
    if(!a||!b)continue;pos(a);pos(b);
    const hot=hN&&(hN.has(e.f)&&hN.has(e.t));
    ctx.strokeStyle=hot?'rgba(120,190,255,.85)':'rgba(90,110,135,.22)';
    ctx.lineWidth=hot?1.6:0.7;ctx.beginPath();ctx.moveTo(a.px,a.py);
    ctx.lineTo(b.px,b.py);ctx.stroke();
    if(hot){{const mx=(a.px+b.px)/2,my=(a.py+b.py)/2;
      ctx.fillStyle='rgba(160,200,255,.9)';ctx.font='10px sans-serif';
      ctx.fillText(e.rel,mx+4,my-2);}}}}
  for(const n of NODES){{pos(n);
    const dim=hN&&!hN.has(n.name);
    ctx.globalAlpha=dim?.25:1;ctx.fillStyle=color(n.type);
    ctx.beginPath();ctx.arc(n.px,n.py,n.pr,0,7);ctx.fill();
    if(!dim&&n.pr>3.5){{ctx.fillStyle='#d8dee6';ctx.font='11px sans-serif';
      ctx.fillText(n.name,n.px+n.pr+3,n.py+4);}}}}
  ctx.globalAlpha=1;requestAnimationFrame(draw);}}
sim();draw();
cv.addEventListener('wheel',ev=>{{ev.preventDefault();
  scale*=ev.deltaY<0?1.12:0.89;scale=Math.max(.3,Math.min(3.5,scale));}},{{passive:false}});
let down=null;
cv.addEventListener('mousedown',ev=>{{down={{x:ev.clientX,y:ev.clientY,px:panX,py:panY}};
  const m=hit(ev.clientX,ev.clientY);if(m)drag=m;}});
addEventListener('mousemove',ev=>{{
  if(drag){{drag.x=(ev.clientX-W/2-panX)/scale+W/2;drag.y=(ev.clientY-H/2-panY)/scale+H/2;
    drag.vx=0;drag.vy=0;hover=drag;return;}}
  if(down){{panX=down.px+ev.clientX-down.x;panY=down.py+ev.clientY-down.y;return;}}
  hover=hit(ev.clientX,ev.clientY);
  if(hover){{tip.style.display='block';
    tip.style.left=Math.min(ev.clientX+14,W-300)+'px';tip.style.top=(ev.clientY+14)+'px';
    tip.innerHTML='<b>'+hover.name+'</b> <span class="t">'+hover.type+
      ' · '+hover.deg+' 连接</span><br/>'+(hover.desc||'（无描述）');}}
  else tip.style.display='none';}});
addEventListener('mouseup',()=>{{down=null;drag=null;}});
function hit(x,y){{for(let i=NODES.length-1;i>=0;i--){{const n=NODES[i];pos(n);
  const dx=x-n.px,dy=y-n.py;if(dx*dx+dy*dy<(n.pr+4)*(n.pr+4))return n;}}return null;}}
</script>
</body>
</html>
"""


def main() -> int:
    configure_stdio_utf8()
    ap = argparse.ArgumentParser(description="RAGFlow knowledge graph -> DSH canvas HTML")
    ap.add_argument("dataset_id")
    ap.add_argument("--top", type=int, default=150, help="按连接数保留前 N 个实体（默认 150）")
    ap.add_argument("--title", default="RAGFlow", help="画布标题前缀")
    ap.add_argument("--out", help="写入文件（默认 stdout）")
    args = ap.parse_args()

    base_url = os.environ.get(RAGFLOW_API_URL_ENV, "").rstrip("/")
    api_key = os.environ.get(RAGFLOW_API_KEY_ENV, "")
    if not base_url or not api_key:
        raise SystemExit(f"需要环境变量 {RAGFLOW_API_URL_ENV} 与 {RAGFLOW_API_KEY_ENV}")

    graph = fetch_graph(base_url, api_key, args.dataset_id)
    nodes, edges = normalize(graph, args.top)
    if not nodes:
        raise SystemExit("图谱为空：先运行图谱构建（ragflow-run-graphrag.sh）")
    types = sorted({n["type"] for n in nodes})
    legend = "".join(
        f'<span><i style="background:{_css(t)}"></i>{t}</span>'
        for t in types)
    html = HTML_TEMPLATE.format(
        title=args.title, nstat=len(nodes), estat=len(edges), legend=legend,
        nodes=json.dumps(nodes, ensure_ascii=False),
        edges=json.dumps(edges, ensure_ascii=False))
    if args.out:
        open(args.out, "w", encoding="utf-8").write(html)
        print(f"written: {args.out} ({len(nodes)} nodes, {len(edges)} edges)")
    else:
        sys.stdout.write(html)
    return 0


def _css(t: str) -> str:
    m = {"EQUIPMENT": "#4fc3f7", "MATERIAL": "#ffb74d", "PROCESS_STEP": "#81c784",
         "ROLE": "#ba68c8", "HAZARD": "#e57373", "DEPARTMENT": "#90a4ae",
         "LOCATION": "#4db6ac", "TOOL": "#fff176", "DOCUMENT": "#b0bec5",
         "CONCEPT": "#64b5f6", "UNKNOWN": "#78909c"}
    return m.get(t, "#78909c")


if __name__ == "__main__":
    raise SystemExit(main())
