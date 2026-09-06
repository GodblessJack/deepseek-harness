#!/usr/bin/env python3
"""kb-updater 知识更新智能体：投喂全行为端到端演示（官方 Python SDK，JSON-RPC
stdio）。4 个代表性 API 请求，分两个会话：

会话 A（部署配置正常）：
  1. 无姓名投喂 → 反问姓名/工号，不执行投喂（留痕必填）。
  2. 补报姓名「王工 GW-0231」→ 全链：质检 → 入库（文档名带投喂人·日期）→
     图谱增量 → 检索自检。
  3. 投喂空白损坏 PDF → 入库质检拒收 + 原因反馈（不污染知识库）。
会话 B（图谱目标配置故意指错，演示半成功）：
  4. 「李工 GW-0455」投喂有效文档 → 文档入库成功、图谱更新失败 →
     明示「文档已入库，图谱更新失败（原因）」，不回滚入库。

persona 从 preset 的 persona.md 注入（业务定义唯一位置）；RAGFlow 凭据由
kb-updater-feed 技能按命令从服务器 token 文件注入（DSH 会剥离凭据形态的变量名），
本驱动无需转发。用法（仓库根目录执行）：
  python3 examples/grid-ops-agent/kb-updater/demo_feed.py [--keep]
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "python" / "sdk" / "src"))

from deepseek_harness import DeepSeekHarness  # noqa: E402

FEED_DIR = REPO / "examples/grid-ops-agent/kb-updater/feed-docs"

SESSION_A_TURNS = [
    f"帮我把这份文档投喂进知识库：{FEED_DIR / '10kV开关柜局部放电带电检测经验（投喂演示）.pdf'}",
    "我是王工，工号 GW-0231，就投刚才那份。",
    f"还是我王工，再投一份：{FEED_DIR / '空白损坏文档（投喂演示-应拒收）.pdf'}",
]

SESSION_B_TURNS = [
    f"我是李工，工号 GW-0455，把这份投喂进知识库，图谱也一并更新：{FEED_DIR / '配电网架空线路防雷要点（投喂演示-半成功场景）.md'}",
]


def build_harness(session_root: Path, graph_dataset_env: str | None):
    persona = (REPO / "apps/cli/config/agent-presets/kb-updater/persona.md").read_text(encoding="utf-8")
    skill_dirs = json.dumps([
        str(REPO / "apps/cli/config/agent-presets/kb-updater/skills"),
    ])
    env = {
        "DSH_SYSTEM_PROMPT": persona,
        "KB_UPDATER_SKILL_DIRS": skill_dirs,
        "RAGFLOW_API_URL": os.environ.get("RAGFLOW_API_URL", "http://127.0.0.1:9380"),
    }
    if graph_dataset_env:
        # 半成功演示：图谱目标库名解析不到 → 图谱步骤失败（入库不受影响）。
        env["KB_UPDATER_GRAPH_DATASET"] = graph_dataset_env
    return DeepSeekHarness(
        model="deepseek-v4-flash",
        cwd=str(REPO),
        runtime_cwd=str(REPO),
        session_root=str(session_root),
        cordis=str(REPO / "examples/grid-ops-agent/kb-updater/sdk-kb-updater.cordis.yml"),
        launch_args_override=(
            "node", "--import", "tsx/esm",
            str(REPO / "packages/examples/jsonrpc-demo/src/bin.ts"),
        ),
        env=env,
        request_timeout_seconds=900,
        shutdown_timeout_seconds=5,
    )


def run_session(name: str, harness, turns: list[str]) -> list[str | None]:
    reasons: list[str | None] = []
    with harness:
        session = harness.start_session()
        print(f"\n########## {name} session_id={session.id} ##########")
        for index, question in enumerate(turns, 1):
            print(f"\n===== {name} 第 {index} 轮 · 用户 =====\n{question}")
            result = session.run(question)
            print(f"\n===== {name} 第 {index} 轮 · kb-updater =====\n{result.final_response}")
            reasons.append(result.finish_reason)
    return reasons


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true", help="保留会话 JSONL 目录")
    parser.add_argument("--skip-b", action="store_true", help="只跑会话 A（正常/拒收）")
    args = parser.parse_args()

    root_a = REPO / "examples/grid-ops-agent/kb-updater/.sessions-a"
    root_b = REPO / "examples/grid-ops-agent/kb-updater/.sessions-b"
    reasons = run_session("会话A·正常投喂/拒收", build_harness(root_a, None), SESSION_A_TURNS)
    if not args.skip_b:
        reasons += run_session(
            "会话B·半成功（图谱目标配置错误）",
            build_harness(root_b, "电网运维-不存在的图谱目标库"), SESSION_B_TURNS)

    print("\n===== finish_reason 汇总 =====")
    for index, reason in enumerate(reasons, 1):
        print(f"第 {index} 轮: {reason}")
    if not args.keep:
        shutil.rmtree(root_a, ignore_errors=True)
        shutil.rmtree(root_b, ignore_errors=True)
    else:
        print(f"session_roots: {root_a} {root_b}")
    return 0 if all(reason == "completed" or reason is None for reason in reasons) else 1


if __name__ == "__main__":
    raise SystemExit(main())
