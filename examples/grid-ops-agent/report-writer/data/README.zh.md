# 历史落库演示数据（14 票）

[English](README.md) | 中文

- `defects.jsonl` / `disposals.jsonl`：缺陷识别记录与处置记录的演示库，**全部记录 `source: "demo"`（14 票演示数据）**，构造生成，非真实运维记录。
- 数据契约（字段含义、追加/检索/统计用法）见 preset 技能：`apps/cli/config/agent-presets/report-writer/skills/report-writer-toolbox/SKILL.md`，工具脚本在该技能 `scripts/history.py`（本目录只是数据，不含业务定义）。
- 覆盖 2026-06～2026-08，41 条识别记录、21 条处置记录；设备、缺陷类型、定级分布供报表统计演示。
- 生产部署时：缺陷识别/处置智能体经 `history.py append-defect|append-disposal` 落库（`source: agent`），本目录替换为真实库。
