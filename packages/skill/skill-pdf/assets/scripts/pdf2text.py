#!/usr/bin/env python3
"""Extract text from a PDF. pypdf first, system pdftotext as fallback.

Fails loud on missing engines, empty page windows, zero-text extraction,
and engine errors; stderr states which one occurred. Exit codes:
0 ok; 1 usage/env (no engine installed, page window selects no pages);
2 no text (scanned or image-only PDF) or every engine failed.
"""
import argparse
import shutil
import subprocess
import sys

HINT = ("no PDF text engine available: install pypdf (pip3 install --user pypdf) "
        "or poppler-utils (pdftotext)")

# Engine result kinds: "ok" text extracted; "notext" engine ran on a non-empty
# page window and found no text; "error" engine failed; "empty" the page window
# selects zero of the document's pages. An engine that is not installed yields
# None and does not count as a failure.

def via_pypdf(path, first, last):
    """Try pypdf. Returns None when pypdf is not installed."""
    try:
        from pypdf import PdfReader
    except ImportError:
        return None
    try:
        reader = PdfReader(path)
        if reader.is_encrypted:
            return ("error", "PDF is password-protected")
        pages = reader.pages[first - 1:last if last else None]
        if not pages:
            return ("empty", len(reader.pages))
        parts = []
        for i, page in enumerate(pages):
            text = (page.extract_text() or "").strip()
            if text:
                parts.append(f"===== Page {first + i} =====\n{text}")
        if not parts:
            return ("notext", None)
        return ("ok", "\n\n".join(parts))
    except Exception as exc:
        return ("error", str(exc))

def via_pdftotext(path, first, last):
    """Try system pdftotext. Returns None when the binary is absent."""
    if shutil.which("pdftotext") is None:
        return None
    cmd = ["pdftotext", "-enc", "UTF-8"]
    if first: cmd += ["-f", str(first)]
    if last: cmd += ["-l", str(last)]
    cmd += [path, "-"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return ("error", proc.stderr.strip() or f"exit code {proc.returncode}")
    if not proc.stdout.strip():
        return ("notext", None)
    return ("ok", proc.stdout)

def no_pages_message(first, last, total):
    end = str(last) if last else "end"
    detail = f" (document has {total} page{'' if total == 1 else 's'})" if total else ""
    return f"page range {first}-{end} selects no pages{detail}"

def die(code, message):
    sys.stderr.write(f"pdf2text: {message}\n")
    sys.exit(code)

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf"); ap.add_argument("--first", type=int, default=1); ap.add_argument("--last", type=int, default=0)
    args = ap.parse_args()
    # Page arguments are 1-based: a non-positive --first or negative --last
    # would silently select the wrong window (negative slices read from the
    # end), so reject them before any engine runs.
    if args.first < 1:
        die(1, f"--first must be >= 1, got {args.first}")
    if args.last < 0:
        die(1, f"--last must be >= 0, got {args.last}")
    if args.last and args.first > args.last:
        die(1, no_pages_message(args.first, args.last, 0))
    engines = (("pypdf", via_pypdf), ("pdftotext", via_pdftotext))
    saw_text_free = False
    failures = []
    for name, run in engines:
        result = run(args.pdf, args.first, args.last)
        if result is None:
            continue
        kind, payload = result
        if kind == "ok":
            sys.stdout.write(payload.strip() + "\n"); sys.exit(0)
        if kind == "empty":
            die(1, no_pages_message(args.first, args.last, payload))
        if kind == "notext":
            saw_text_free = True
        else:
            failures.append(f"{name}: {' '.join(payload.split())}")
    if saw_text_free:
        die(2, "no extractable text (scanned or image-only PDF; OCR is not supported)")
    if failures:
        die(2, f"all PDF engines failed: {'; '.join(failures)}")
    die(1, HINT)

if __name__ == "__main__":
    main()
