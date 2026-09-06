#!/usr/bin/env python3
"""report-writer 报表生成智能体：3 个代表性 API 请求端到端演示（官方 Python SDK，
JSON-RPC stdio）。

一个会话三轮：①要点扩写成月报 → ②基于历史落库的统计报表 + 离线 PDF 导出 →
③按设备/时间的专项统计对比。persona 从 preset 的 persona.md 注入（业务定义唯一
位置）；统计取数与 PDF 生成走 report-writer-toolbox 技能脚本（本地离线）。

用法（仓库根目录执行）：
  python3 examples/grid-ops-agent/report-writer/demo_report.py [--keep]

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

TURNS = [
    "把下面要点扩写成《110kV城东变2026年8月设备运维月报》："
    "①8月完成2次全站红外测温特巡；②发现并闭环处置危急缺陷1项（35kV城南线电缆终端接线端子过热）；"
    "③完成2号主变散热器风机异响消缺；④下月计划开展GIS室SF6漏检专项排查。",
    "再基于系统内历史落库数据，补全这份月报的缺陷统计分析部分"
    "（8月的识别次数、类型分布、定级分布，和6、7月的环比），然后把整份报告导出成PDF，给我文件路径。",
    "单独查一下：城东变和河西变2026年6月到8月各发现多少条缺陷记录？"
    "按设备给个对比表，顺带说说河西变GIS设备的缺陷情况。",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true", help="保留会话 JSONL 目录")
    args = parser.parse_args()

    persona = (REPO / "apps/cli/config/agent-presets/report-writer/persona.md").read_text(encoding="utf-8")
    skill_dirs = json.dumps([
        str(REPO / "apps/cli/config/agent-presets/report-writer/skills"),
    ])
    session_root = REPO / "examples/grid-ops-agent/report-writer/.sessions"

    harness = DeepSeekHarness(
        model="deepseek-v4-flash",
        cwd=str(REPO),
        runtime_cwd=str(REPO),
        session_root=str(session_root),
        cordis=str(REPO / "examples/grid-ops-agent/report-writer/sdk-report-writer.cordis.yml"),
        launch_args_override=(
            "node", "--import", "tsx/esm",
            str(REPO / "packages/examples/jsonrpc-demo/src/bin.ts"),
        ),
        env={
            "DSH_SYSTEM_PROMPT": persona,
            "REPORT_WRITER_SKILL_DIRS": skill_dirs,
            **{name: os.environ[name] for name in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL") if os.environ.get(name)},
        },
        request_timeout_seconds=900,
        shutdown_timeout_seconds=5,
    )

    reasons: list[str | None] = []
    with harness:
        session = harness.start_session()
        print(f"session_id={session.id}")
        for index, question in enumerate(TURNS, 1):
            print(f"\n===== 第 {index} 轮 · 用户 =====\n{question}")
            result = session.run(question)
            print(f"\n===== 第 {index} 轮 · report-writer =====\n{result.final_response}")
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
