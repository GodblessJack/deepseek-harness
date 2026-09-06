# Historical store demo data (ticket 14)

English | [中文](README.zh.md)

- `defects.jsonl` / `disposals.jsonl`: demo stores of defect identification records and disposal records, **every record `source: "demo"` (ticket 14 demo data)**, synthetically generated, not real O&M records.
- The data contract (field meanings, append/query/statistics usage) lives in the preset skill: `apps/cli/config/agent-presets/report-writer/skills/report-writer-toolbox/SKILL.md`; the tooling is that skill's `scripts/history.py` (this directory is data only, no business definition).
- Covers 2026-06 through 2026-08: 41 identification records and 21 disposal records; the equipment, defect-type, and grade distributions feed the report statistics demos.
- In production: the inspection and advisory agents write via `history.py append-defect|append-disposal` (`source: agent`), and this directory is replaced by the real store.
