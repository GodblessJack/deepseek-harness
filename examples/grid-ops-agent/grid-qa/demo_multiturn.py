#!/usr/bin/env python3
"""grid-qa 知识问答智能体：多轮追问端到端演示（官方 Python SDK，JSON-RPC stdio）。

在一个会话里连问三轮，演示：检索命中规程（带出处）→ 上下文延续的追问 →
「讲解一下」触发讲解导向。persona 从 preset 的 persona.md 注入（业务定义唯一
位置）；RAGFlow 凭据由 grid-qa-retrieval 技能按命令从服务器 token 文件注入
（DSH 会从 shell 环境剥离凭据形态的变量名），本驱动无需转发。

用法（仓库根目录执行）：
  python3 examples/grid-ops-agent/grid-qa/demo_multiturn.py [--keep]

每轮打印 用户问题 与 智能体回答 全文；结果汇总打印 finish_reason。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "python" / "sdk" / "src"))

from deepseek_harness import DeepSeekHarness  # noqa: E402

QUESTIONS = [
    "35kV架空线路穿越树竹速长区，巡视周期怎么安排？",
    "如果那段通道环境还经常有人烧秸秆，巡视上还要注意什么？",
    "讲解一下为什么树竹速长区要加密巡视。",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true", help="保留会话 JSONL 目录")
    args = parser.parse_args()

    persona = (REPO / "apps/cli/config/agent-presets/grid-qa/persona.md").read_text(encoding="utf-8")
    skill_dirs = json.dumps([
        str(REPO / "apps/cli/config/agent-presets/grid-qa/skills"),
    ])
    session_root = REPO / "examples/grid-ops-agent/grid-qa/.sessions"

    harness = DeepSeekHarness(
        model="deepseek-v4-flash",
        cwd=str(REPO),
        runtime_cwd=str(REPO),
        session_root=str(session_root),
        cordis=str(REPO / "examples/grid-ops-agent/grid-qa/sdk-grid-qa.cordis.yml"),
        launch_args_override=(
            "node", "--import", "tsx/esm",
            str(REPO / "packages/examples/jsonrpc-demo/src/bin.ts"),
        ),
        env={
            "DSH_SYSTEM_PROMPT": persona,
            "GRID_QA_SKILL_DIRS": skill_dirs,
            **{name: os.environ[name] for name in ("RAGFLOW_API_URL", "RAGFLOW_API_KEY") if os.environ.get(name)},
        },
        request_timeout_seconds=600,
        shutdown_timeout_seconds=5,
    )

    reasons: list[str | None] = []
    with harness:
        session = harness.start_session()
        print(f"session_id={session.id}")
        for index, question in enumerate(QUESTIONS, 1):
            print(f"\n===== 第 {index} 轮 · 用户 =====\n{question}")
            result = session.run(question)
            print(f"\n===== 第 {index} 轮 · grid-qa =====\n{result.final_response}")
            reasons.append(result.finish_reason)

    print("\n===== finish_reason 汇总 =====")
    for index, reason in enumerate(reasons, 1):
        print(f"第 {index} 轮: {reason}")
    if args.keep:
        print(f"session_root={session_root}")
    else:
        import shutil
        shutil.rmtree(session_root, ignore_errors=True)
    return 0 if all(reason == "completed" or reason is None for reason in reasons) else 1


if __name__ == "__main__":
    raise SystemExit(main())
