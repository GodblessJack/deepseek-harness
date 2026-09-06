/**
 * Self-contained HTML artifact rendering for the hub graph: vendored
 * force-graph, embedded data island, hierarchical layout (hub → library →
 * entities), collapse/expand, search, and legend — all offline.
 * @module @deepseek-ai/dsh-host-kg
 */

import { readFile } from 'node:fs/promises'
import type { KgGraphData } from './types.ts'

/** Type palette shared by the renderer and the legend; unknown types fall back to gray. */
export const TYPE_PALETTE: Readonly<Record<string, string>> = {
  CONCEPT: '#5b8cff',
  EVENT: '#ff7ab8',
  PERSON: '#ffb454',
  LOCATION: '#4dd6a1',
  ORGANIZATION: '#c792ea',
  PRODUCT: '#7fdbff',
  EQUIPMENT: '#37d6c0',
  HAZARD: '#ff6b6b',
  PROCESS_STEP: '#ffd166',
  MATERIAL: '#b48cff',
  DOCUMENT: '#8aa6c8',
  ROLE: '#f2a6ff',
  TOOL: '#7be0a2',
  未分类: '#9aa7c4',
}

const PAGE_SCRIPT = String.raw`
(function () {
  'use strict'
  var DATA = window.__KG__
  var PALETTE = window.__PALETTE__
  var collapsed = new Set()

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  function typeColor(type) { return PALETTE[type] || '#9aa7c4' }

  // Flatten: hub + library nodes + entity nodes; member links pull entities
  // toward their library so clusters form without drawing those links.
  var nodes = [], links = [], nameToLibs = new Map(), entities = new Map()
  nodes.push({ id: '__hub__', name: DATA.hub, kind: 'hub' })
  DATA.libraries.forEach(function (lib, li) {
    nodes.push({
      id: 'lib:' + lib.id, name: lib.name, kind: 'library', libId: lib.id,
      stats: lib.error ? '拉取失败' : (lib.empty ? '未构建图谱' : lib.nodes.length + ' 实体 · ' + lib.edges.length + ' 关系'),
      state: lib.error ? 'error' : (lib.empty ? 'empty' : 'ok'), idx: li,
    })
    links.push({ source: '__hub__', target: 'lib:' + lib.id, kind: 'spoke' })
    lib.nodes.forEach(function (ent) {
      var nid = 'e:' + lib.id + ':' + ent.name
      entities.set(nid, { id: nid, name: ent.name, kind: 'entity', libId: lib.id, type: ent.type, desc: ent.description || '' })
      nodes.push(entities.get(nid))
      links.push({ source: 'lib:' + lib.id, target: nid, kind: 'member', libId: lib.id })
      if (!nameToLibs.has(ent.name)) nameToLibs.set(ent.name, [])
      nameToLibs.get(ent.name).push(lib.name)
    })
    lib.edges.forEach(function (e) {
      links.push({ source: 'e:' + lib.id + ':' + e.source, target: 'e:' + lib.id + ':' + e.target, kind: 'edge', libId: lib.id, label: e.relationship || '' })
    })
  })

  var totals = DATA.libraries.reduce(function (acc, lib) {
    acc.n += lib.nodes.length; acc.e += lib.edges.length
    if (lib.error) acc.failed += 1
    if (lib.empty) acc.empty += 1
    return acc
  }, { n: 0, e: 0, failed: 0, empty: 0 })

  // ── header ────────────────────────────────────────────────────────────────
  var header = document.getElementById('kg-header')
  header.innerHTML =
    '<div class="title">' + esc(DATA.hub) +
      '<span class="sub">' + DATA.libraries.length + ' 知识库 · ' + totals.n + ' 实体 · ' + totals.e + ' 关系' +
      (totals.failed ? ' · <span class="warn">' + totals.failed + ' 库拉取失败</span>' : '') +
      (totals.empty ? ' · <span class="dim">' + totals.empty + ' 库未构建</span>' : '') + '</span></div>' +
    '<div class="tools"><input id="kg-search" placeholder="搜索实体…" autocomplete="off"/></div>' +
    '<div class="stamp">' + new Date(DATA.generatedAt).toLocaleString() + '</div>'

  // ── legend from the types actually present ────────────────────────────────
  var present = new Set()
  DATA.libraries.forEach(function (lib) { lib.nodes.forEach(function (n) { present.add(n.type) }) })
  var legend = document.getElementById('kg-legend')
  legend.innerHTML = '<span class="lg"><i class="dot hub"></i>中心</span><span class="lg"><i class="dot lib"></i>知识库</span>' +
    Array.from(present).sort().map(function (t) {
      return '<span class="lg"><i class="dot" style="background:' + typeColor(t) + '"></i>' + esc(t) + '</span>'
    }).join('') +
    '<span class="lg dim">点击知识库节点收起/展开 · 滚轮缩放 · 拖拽</span>'

  // ── graph ─────────────────────────────────────────────────────────────────
  var zoomK = 1, highlight = new Set()
  var elem = document.getElementById('kg-graph')
  var graph = new ForceGraph()(elem)
    .graphData({ nodes: nodes, links: links })
    .nodeId('id')
    .nodeVal(function (n) { return n.kind === 'hub' ? 14 : (n.kind === 'library' ? 7 : (highlight.size && highlight.has(n.id) ? 2.4 : 1)) })
    .nodeLabel(function (n) {
      if (n.kind === 'hub') return n.name
      if (n.kind === 'library') return n.name + '\n' + (n.stats || '')
      var also = (nameToLibs.get(n.name) || []).filter(function (l) { return l })
      return n.name + ' [' + n.type + ']' + (n.desc ? '\n' + n.desc.slice(0, 160) : '') +
        (also.length > 1 ? '\n同名实体另见: ' + also.join(', ') : '')
    })
    .nodeCanvasObject(function (n, ctx, globalScale) {
      var x = n.x, y = n.y
      if (n.kind === 'hub') {
        ctx.beginPath(); ctx.arc(x, y, 16, 0, 2 * Math.PI)
        ctx.fillStyle = 'rgba(255,209,102,.14)'; ctx.fill()
        ctx.beginPath(); ctx.arc(x, y, 9, 0, 2 * Math.PI)
        ctx.fillStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 18; ctx.fill(); ctx.shadowBlur = 0
        ctx.fillStyle = '#fff'; ctx.font = '600 11px system-ui,sans-serif'; ctx.textAlign = 'center'
        ctx.fillText(n.name, x, y + 26)
        return
      }
      if (n.kind === 'library') {
        var ok = n.state === 'ok'
        var col = ok ? '#5b8cff' : (n.state === 'error' ? '#e5484d' : '#6b7590')
        ctx.beginPath(); ctx.arc(x, y, 11, 0, 2 * Math.PI)
        ctx.fillStyle = 'rgba(91,140,255,.16)'; ctx.fill()
        ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 2 * Math.PI)
        ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0
        ctx.fillStyle = ok ? '#e8edf7' : '#9aa7c4'
        ctx.font = (collapsed.has(n.libId) ? '' : '600 ') + '11px system-ui,sans-serif'
        ctx.textAlign = 'center'; ctx.fillText(n.name, x, y + 22)
        ctx.fillStyle = '#9aa7c4'; ctx.font = '10px system-ui,sans-serif'
        ctx.fillText(n.stats, x, y + 34)
        return
      }
      var r = highlight.has(n.id) ? 5 : 3
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI)
      ctx.fillStyle = typeColor(n.type); ctx.globalAlpha = highlight.size && !highlight.has(n.id) ? 0.25 : 0.95
      ctx.fill(); ctx.globalAlpha = 1
      if (globalScale > 1.4 || highlight.has(n.id)) {
        ctx.fillStyle = highlight.has(n.id) ? '#fff' : '#c7d0e4'
        ctx.font = '10px system-ui,sans-serif'; ctx.textAlign = 'center'
        ctx.fillText(n.name, x, y - 6)
      }
    })
    .linkColor(function (l) { return l.kind === 'spoke' ? 'rgba(91,140,255,.35)' : 'rgba(140,160,200,.22)' })
    .linkWidth(function (l) { return l.kind === 'spoke' ? 2 : 1 })
    .linkVisibility(function (l) { return l.kind !== 'member' })
    .linkLabel(function (l) { return l.kind === 'edge' ? (l.label || '') : '' })
    .onNodeClick(function (n) {
      if (n.kind !== 'library') return
      if (collapsed.has(n.libId)) collapsed.delete(n.libId); else collapsed.add(n.libId)
      applyVisibility()
    })
    .onZoom(function (z) { zoomK = z.k })
    .cooldownTime(6000)

  graph.d3Force('charge').strength(function (n) { return n.kind === 'hub' ? -320 : (n.kind === 'library' ? -160 : -24) })
  graph.d3Force('link').distance(function (l) { return l.kind === 'spoke' ? 200 : (l.kind === 'member' ? 46 : 58) })
  setTimeout(function () { graph.zoomToFit(600, 60) }, 1200)

  function applyVisibility() {
    var vis = nodes.filter(function (n) {
      if (n.kind !== 'entity') return true
      return !collapsed.has(n.libId)
    })
    var visLinks = links.filter(function (l) {
      return l.libId === undefined || !collapsed.has(l.libId)
    })
    graph.graphData({ nodes: vis, links: visLinks })
    graph.d3ReheatSimulation()
  }

  document.getElementById('kg-search').addEventListener('input', function (e) {
    var q = e.target.value.trim().toLowerCase()
    highlight = new Set()
    if (!q) { graph.nodeVal(graph.nodeVal()); return redraw() }
    entities.forEach(function (n) {
      if (n.name.toLowerCase().includes(q)) highlight.add(n.id)
    })
    redraw()
    var first = null
    entities.forEach(function (n) { if (first === null && highlight.has(n.id) && n.x !== undefined) first = n })
    if (first !== null) { graph.centerAt(first.x, first.y, 500); graph.zoom(2.2, 500) }
  })
  function redraw() { graph.nodeVal(graph.nodeVal()) }
})()
`

const PAGE_CSS = String.raw`
  :root { --bg:#0b1020; --panel:#121a30d9; --ink:#e8edf7; --muted:#9aa7c4; --accent:#5b8cff; --line:#223052 }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  html, body { height: 100% }
  body {
    font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, -apple-system, sans-serif;
    background: radial-gradient(1200px 800px at 50% -10%, #17203a 0%, var(--bg) 60%);
    color: var(--ink); overflow: hidden; display: flex; flex-direction: column;
  }
  #kg-header {
    display: flex; align-items: center; gap: 16px; padding: 10px 16px;
    background: var(--panel); border-bottom: 1px solid var(--line); flex: 0 0 auto;
  }
  #kg-header .title { font-size: 15px; font-weight: 600; letter-spacing: .5px; white-space: nowrap }
  #kg-header .title .sub { font-size: 11px; font-weight: 400; color: var(--muted); margin-left: 10px }
  #kg-header .sub .warn { color: #e5484d }
  #kg-header .sub .dim { color: #6b7590 }
  #kg-header .tools { flex: 1; display: flex; justify-content: center }
  #kg-search {
    width: min(320px, 40vw); padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line);
    background: #0e1526; color: var(--ink); font-size: 12px; outline: none;
  }
  #kg-search:focus { border-color: var(--accent) }
  #kg-header .stamp { font-size: 11px; color: var(--muted); white-space: nowrap }
  #kg-legend {
    display: flex; flex-wrap: wrap; gap: 14px; padding: 6px 16px; font-size: 11px; color: var(--muted);
    background: var(--panel); border-bottom: 1px solid var(--line); flex: 0 0 auto;
  }
  #kg-legend .lg { display: inline-flex; align-items: center; gap: 5px }
  #kg-legend .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--muted) }
  #kg-legend .dot.hub { background: #ffd166; box-shadow: 0 0 6px #ffd166 }
  #kg-legend .dot.lib { background: var(--accent); box-shadow: 0 0 6px var(--accent) }
  #kg-legend .dim { color: #6b7590 }
  #kg-graph { flex: 1 1 auto; min-height: 0 }
  #kg-graph canvas { display: block; cursor: grab }
`

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/**
 * Render the hub graph into one self-contained HTML document.
 * @param data - the assembled hub graph.
 * @param title - artifact title shown in the browser tab.
 * @param forceGraphJs - the vendored force-graph UMD payload.
 * @returns the complete HTML string, ready for `canvas.write`.
 */
export function renderKgHtml(data: KgGraphData, title: string, forceGraphJs: string): string {
  const dataJson = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')
  const paletteJson = JSON.stringify(TYPE_PALETTE).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div id="kg-header"></div>
<div id="kg-legend"></div>
<div id="kg-graph"></div>
<script>${forceGraphJs}</script>
<script>window.__KG__ = ${dataJson}; window.__PALETTE__ = ${paletteJson};</script>
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`
}

/** Read the vendored force-graph UMD asset shipped beside the compiled output. */
export async function readForceGraphAsset(): Promise<string> {
  return readFile(new URL('../assets/force-graph.min.js', import.meta.url), 'utf8')
}
