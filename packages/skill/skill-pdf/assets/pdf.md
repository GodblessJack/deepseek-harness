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
3. Exit code 1 → usage or environment problem (no engine installed, or the page
   range selects no pages): report the stderr diagnosis verbatim.
   Exit code 2 → no extractable text (scanned or image-only PDF; OCR is not
   supported) or every engine failed: say so and relay the stderr diagnosis.
4. Never invent PDF content you have not extracted.
