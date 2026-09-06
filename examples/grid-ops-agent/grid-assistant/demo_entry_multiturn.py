#!/usr/bin/env python3
"""入口（运维助手）grid-assistant：多轮路由端到端演示（官方 Python SDK，JSON-RPC stdio）。

两个会话，覆盖入口的两条多轮行为（一轮 headless 难以表达的闭环）：

- 会话 A（拍照全链存疑中止）：模糊缺陷描述 → 入口委派缺陷识别 → 识别存疑返回
  澄清反问 → 入口转述、链中止（不进处置建议）；用户表示无法补充 → 再委派 →
  部分判断 + 人工复核收尾，仍不进处置建议（无定级不给建议）。
- 会话 B（图像消歧闭环）：双义输入 → 入口〔需澄清〕反问（识别还是入库）→
  用户表达入库意图 → 入口委派知识更新 → 能力面的留痕姓名反问原样转达。
  会话止于姓名反问：投喂的内部行为是 14 票演示证据，此处只证路由闭环，
  不重复执行入库（也避免向演示库重复投喂同一文档）。

入口 persona 从 preset 的 persona.md 注入（路由业务定义唯一位置）；五个能力面
的 persona 由 sdk 组合的委派行从各自 preset 的 persona.md 读取；RAGFlow 凭据由
各能力面技能按命令从服务器 token 文件注入，本驱动无需转发。

用法（仓库根目录执行）：
  python3 examples/grid-ops-agent/grid-assistant/demo_entry_multiturn.py [--keep]

每轮打印 用户消息 与 运维助手回答 全文；结果汇总打印 finish_reason。
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

SESSION_A = [
    "城北线一基铁塔的绝缘子好像有点问题，你帮我看看，顺便说下要不要紧、该怎么处理。",
    "没有望远镜也没有无人机，后台暂时查不到昨晚的跳闸记录。那基塔只能远看：瓷裙边缘确实缺了一小块，但逆光，裂纹、瓷胎和钢帽钢脚都看不清，光线角度换不了，现场也没法再靠近。这样能定级处理吗？",
]

SESSION_B = [
    "我刚在站里拍了份开关柜的局部放电检测资料，帮我处理一下。",
    "存进知识库。",
]

FACES = ["grid-qa", "defect-inspector", "fault-advisor", "report-writer", "kb-updater"]


def run_session(harness: DeepSeekHarness, label: str, turns: list[str]) -> list[str | None]:
    reasons: list[str | None] = []
    session = harness.start_session()
    print(f"\n########## 会话 {label} · session_id={session.id} ##########")
    for index, message in enumerate(turns, 1):
        print(f"\n===== 会话 {label} 第 {index} 轮 · 用户 =====\n{message}")
        result = session.run(message)
        print(f"\n===== 会话 {label} 第 {index} 轮 · 运维助手 =====\n{result.final_response}")
        reasons.append(result.finish_reason)
    return reasons


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true", help="保留会话 JSONL 目录")
    args = parser.parse_args()

    presets = REPO / "apps/cli/config/agent-presets"
    persona = (presets / "grid-assistant/persona.md").read_text(encoding="utf-8")
    skill_dirs = json.dumps([str(presets / face / "skills") for face in FACES])
    session_root = REPO / "examples/grid-ops-agent/grid-assistant/.sessions"

    harness = DeepSeekHarness(
        model="deepseek-v4-flash",
        cwd=str(REPO),
        runtime_cwd=str(REPO),
        session_root=str(session_root),
        cordis=str(REPO / "examples/grid-ops-agent/grid-assistant/sdk-grid-assistant.cordis.yml"),
        launch_args_override=(
            "node", "--import", "tsx/esm",
            str(REPO / "packages/examples/jsonrpc-demo/src/bin.ts"),
        ),
        env={
            "DSH_SYSTEM_PROMPT": persona,
            "GRID_ASSISTANT_SKILL_DIRS": skill_dirs,
            **{name: os.environ[name] for name in ("RAGFLOW_API_URL", "RAGFLOW_API_KEY") if os.environ.get(name)},
        },
        request_timeout_seconds=600,
        shutdown_timeout_seconds=5,
    )

    reasons: list[str | None] = []
    with harness:
        reasons += run_session(harness, "A（全链存疑中止）", SESSION_A)
        reasons += run_session(harness, "B（图像消歧闭环）", SESSION_B)

    print("\n===== finish_reason 汇总 =====")
    for index, reason in enumerate(reasons, 1):
        print(f"第 {index} 轮: {reason}")
    if args.keep:
        print(f"session_root={session_root}")
    else:
        shutil.rmtree(session_root, ignore_errors=True)
    return 0 if all(reason in ("completed", None) for reason in reasons) else 1


if __name__ == "__main__":
    raise SystemExit(main())
