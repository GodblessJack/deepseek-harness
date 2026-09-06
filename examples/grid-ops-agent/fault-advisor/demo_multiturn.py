#!/usr/bin/env python3
"""fault-advisor 处置建议智能体：多轮分层建议端到端演示（官方 Python SDK，JSON-RPC stdio）。

在一个会话里发三个代表性请求，演示需求条文的判定性行为：建议成功（定级骨架 +
分步核心处置带规程依据 + 工作票安全提示 + 固定定位声明）→ 严重定级自动附带关联
设备排查 → 追问客户侧数据（补气还能撑多久、班组排班）时不编造。persona 从
preset 的 persona.md 注入（业务定义唯一位置）；RAGFlow 凭据由 fault-advising
技能按命令从服务器 token 文件注入（DSH 会从 shell 环境剥离凭据形态的变量名），
本驱动无需转发。

用法（仓库根目录执行）：
  python3 examples/grid-ops-agent/fault-advisor/demo_multiturn.py [--keep]

每轮打印 用户描述 与 智能体回答 全文；结果汇总打印 finish_reason。
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
    "110kV电缆户外终端C相尾管发热，红外测温相间最大温差17.3℃，缺陷识别已判定为严重缺陷，请给处置建议。",
    "另外一台110kV GIS断路器气室SF6压力表读数0.42MPa，低于额定0.45MPa，近两周已补气两次，红外检漏在气路管道连接阀处发现泄漏，请给处置建议。",
    "这两次补气之间气大概还能撑几天？检修班组明天有没有人能去处理？",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true", help="保留会话 JSONL 目录")
    args = parser.parse_args()

    persona = (REPO / "apps/cli/config/agent-presets/fault-advisor/persona.md").read_text(encoding="utf-8")
    skill_dirs = json.dumps([
        str(REPO / "apps/cli/config/agent-presets/fault-advisor/skills"),
    ])
    session_root = REPO / "examples/grid-ops-agent/fault-advisor/.sessions"

    harness = DeepSeekHarness(
        model="deepseek-v4-flash",
        cwd=str(REPO),
        runtime_cwd=str(REPO),
        session_root=str(session_root),
        cordis=str(REPO / "examples/grid-ops-agent/fault-advisor/sdk-fault-advisor.cordis.yml"),
        launch_args_override=(
            "node", "--import", "tsx/esm",
            str(REPO / "packages/examples/jsonrpc-demo/src/bin.ts"),
        ),
        env={
            "DSH_SYSTEM_PROMPT": persona,
            "FAULT_ADVISOR_SKILL_DIRS": skill_dirs,
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
            print(f"\n===== 第 {index} 轮 · fault-advisor =====\n{result.final_response}")
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
