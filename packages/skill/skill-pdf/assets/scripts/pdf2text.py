#!/usr/bin/env python3
"""Extract text from a PDF. pypdf first, system pdftotext as fallback.

Fails loud on missing engines, encrypted PDFs, and zero-text extraction;
stderr explains the remedy. Exit codes: 0 ok, 1 usage/env, 2 no text.
"""
import argparse
import shutil
import subprocess
import sys

HINT = ("no PDF text engine available: install pypdf (pip3 install --user pypdf) "
        "or poppler-utils (pdftotext)")

def via_pypdf(path, first, last):
    try:
        from pypdf import PdfReader
    except ImportError:
        return None
    try:
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise RuntimeError("PDF is password-protected")
        pages = reader.pages[first - 1:last if last else None]
        parts = [f"===== Page {first + i} =====\n{p.extract_text() or ''}" for i, p in enumerate(pages)]
        return "\n\n".join(parts)
    except RuntimeError:
        raise
    except Exception as exc:  # pypdf 解析错误也让位 fallback 之外的引擎报错路径
        return f"__pypdf_error__:{exc}"

def via_pdftotext(path, first, last):
    if shutil.which("pdftotext") is None:
        return None
    cmd = ["pdftotext", "-enc", "UTF-8"]
    if first: cmd += ["-f", str(first)]
    if last: cmd += ["-l", str(last)]
    cmd += [path, "-"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return f"__pdftotext_error__:{proc.stderr.strip()}"
    return proc.stdout

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf"); ap.add_argument("--first", type=int, default=1); ap.add_argument("--last", type=int, default=0)
    args = ap.parse_args()
    results = [via_pypdf(args.pdf, args.first, args.last), via_pdftotext(args.pdf, args.first, args.last)]
    for text in results:
        if text is None: continue
        if text.startswith("__pypdf_error__") or text.startswith("__pdftotext_error__"):
            sys.stderr.write(f"pdf2text: engine failed: {text.split(':', 1)[1]}\n"); continue
        stripped = text.strip()
        if not stripped:
            sys.stderr.write("pdf2text: no extractable text (scanned or image-only PDF; OCR is not supported)\n")
            sys.exit(2)
        sys.stdout.write(stripped + "\n"); sys.exit(0)
    sys.stderr.write(f"pdf2text: {HINT}\n"); sys.exit(1)

if __name__ == "__main__":
    main()
