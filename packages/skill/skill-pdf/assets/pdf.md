# PDF text extraction

Use when a message references an uploaded PDF (`[attached file] uploads/<name>.pdf`)
or the user asks about any PDF in the workspace.

## Extract

```bash
python3 <skill scripts directory>/pdf2text.py <path-to.pdf> [--first N] [--last M] > <stem>.txt
```

The `<skill scripts directory>` is this skill's resource base plus `scripts/`.

Procedure:
1. Unknown length? Run once with `--first 1 --last 3`, read the output; the tool
   `read` on the redirected `.txt` paginates the rest (`offset`/`limit`).
2. Large documents: extract in page windows and only read the windows the task needs.
3. Exit code 1 → no engine installed: report the stderr install hint verbatim.
   Exit code 2 → no extractable text (scanned PDF): say so; OCR is not supported.
4. Never invent PDF content you have not extracted.
