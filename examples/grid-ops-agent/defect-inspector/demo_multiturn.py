#!/usr/bin/env python3
"""defect-inspector 缺陷识别智能体：多轮澄清端到端演示（官方 Python SDK，JSON-RPC stdio）。

在一个会话里发三个代表性请求，演示需求条文的判定性行为：识别成功（类型+部位+
定级）→ 存疑时澄清式交互（说明判据缺口、反问请求配合，不出数字置信度）→
澄清后仍存疑才建议人工复核。persona 从 preset 的 persona.md 注入（业务定义唯一
位置）；RAGFlow 凭据由 defect-inspection 技能按命令从服务器 token 文件注入
（DSH 会从 shell 环境剥离凭据形态的变量名），本驱动无需转发。

用法（仓库根目录执行）：
  python3 examples/grid-ops-agent/defect-inspector/demo_multiturn.py [--keep]

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
    "110kV电缆户外终端C相尾管发热，红外测温相间最大温差17.3℃，C相较另外两相明显发红，环境温度正常，请判定缺陷。",
    "再看一基铁塔：绝缘子好像有点问题，你帮我判定下。",
    "没有望远镜也没有无人机，后台暂时查不到昨晚的跳闸记录。那基塔只能远看：瓷裙边缘确实缺了一小块，但逆光，裂纹、瓷胎和钢帽钢脚都看不清，光线角度换不了，现场也没法再靠近。这样能定级吗？",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true", help="保留会话 JSONL 目录")
    args = parser.parse_args()

    persona = (REPO / "apps/cli/config/agent-presets/defect-inspector/persona.md").read_text(encoding="utf-8")
    skill_dirs = json.dumps([
        str(REPO / "apps/cli/config/agent-presets/defect-inspector/skills"),
    ])
    session_root = REPO / "examples/grid-ops-agent/defect-inspector/.sessions"

    harness = DeepSeekHarness(
        model="deepseek-v4-flash",
        cwd=str(REPO),
        runtime_cwd=str(REPO),
        session_root=str(session_root),
        cordis=str(REPO / "examples/grid-ops-agent/defect-inspector/sdk-defect-inspector.cordis.yml"),
        launch_args_override=(
            "node", "--import", "tsx/esm",
            str(REPO / "packages/examples/jsonrpc-demo/src/bin.ts"),
        ),
        env={
            "DSH_SYSTEM_PROMPT": persona,
            "DEFECT_INSPECTOR_SKILL_DIRS": skill_dirs,
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
            print(f"\n===== 第 {index} 轮 · defect-inspector =====\n{result.final_response}")
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
