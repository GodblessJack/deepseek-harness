---
description: "The bundled pdf skill for users and maintainers relying on, tuning, or debugging workspace PDF text extraction."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-pdf

English | [中文](README.zh.md)

## Summary

Agents can load the bundled `pdf` skill and follow its instructions for extracting text from PDF files in the workspace, most prominently attachments uploaded through the composer into the session workspace `uploads/` tree. The provider has no configuration and ships enabled in the bundled compositions, so every session's skill catalog carries the `pdf` entry. Extraction runs through a packaged Python script that prefers `pypdf` and falls back to system `pdftotext`, so the host needs at most one of them.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin to make the `pdf` skill available in the session skill catalog; the model then loads it by name before extracting PDF text.

### When to choose it

Choose this provider when sessions receive PDF files — composer uploads landing under the workspace `uploads/` tree, or any PDF already present in the workspace — and the model must read their text. The shipped compositions carry the row enabled because uploaded attachments are useless without it. Omit or disable the row in deployments that never see PDFs.

### Mount the plugin

The plugin has no configuration. Its composition row is:

```yaml
- name: '@deepseek-ai/dsh-skill-pdf'
```

After mounting, `pdf` appears in the available skills of the session catalog. The skill body directs the model to run `assets/scripts/pdf2text.py` against the PDF and read the redirected `.txt` output, paging through it with the `read` tool instead of loading whole documents at once.

### Host requirements

The script needs exactly one PDF text engine on the host; both is fine.

- `pypdf` — `pip3 install --user pypdf` (preferred engine; adds page markers)
- `poppler-utils` — provides the `pdftotext` binary (fallback engine)

With neither, the script exits with code 1 and prints the install hint above on stderr; the skill body tells the model to report that hint verbatim.

### Observable success and failures

Mounting the plugin makes `pdf` appear in the catalog and loadable by name; disposal removes it. A successful extraction writes extracted text to stdout (exit 0). A PDF no engine can parse fails loudly with the engine error on stderr (exit 1 after both engines fail); the model reports the failure instead of guessing content.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the bundled provider is wired; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The provider is an immutable, synchronously registered skill source: it registers one fixed candidate at the bundled skill rank (600) under the provider name `pdf`, exposes its packaged `assets/` directory as the skill's directory resource base, and reads the skill body from the packaged `assets/pdf.md` file on every load. The model resolves `scripts/pdf2text.py` against the resource base rendered by the skill loader.

The script prefers `pypdf`, falls back to system `pdftotext`, and never silently swallows failure: missing engines, parse failures, password-protected PDFs, and zero-text extraction each produce a stderr diagnosis with a distinct exit code (0 ok, 1 usage/env, 2 no text).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry and the immutable provider: one candidate, resource base, body load |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion |
| [`assets/pdf.md`](assets/pdf.md) | Skill body: when to extract and the extraction procedure |
| [`assets/scripts/pdf2text.py`](assets/scripts/pdf2text.py) | Extraction script: pypdf first, pdftotext fallback, loud failures |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the registry this provider registers on to how the skill reaches the model.

- [Skill subsystem reference](../../../docs/subsystems/skills.md) — the registry and provider contract this provider implements.
- [skill package](../skill/README.md) — the registry the provider registers on, and the shared rendering of loaded skills.
- [tool-skill package](../tool-skill/README.md) — how the pdf skill reaches the session catalog and the model.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-skill`, which renders the provider's catalog entry and the selected skill body to the model.

#### KV Cache effect

Its catalog entry and any loaded body change the provider KV prefix at their insertion points. The extraction itself runs as ordinary shell commands whose output and tokens depend on the PDF windows the task reads.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the bundled provider does not do. They are current package constraints, not a task backlog.

- **One fixed skill, no runtime customization** — the provider contributes exactly the `pdf` skill; deployments wanting different extraction behavior author their own skill instead.
- **OCR is out of scope** — scanned or image-only PDFs have no extractable text; exit code 2 (or page markers with no body text, see below) is the loud stop.
- **pypdf zero-text nuance** — the pypdf path always emits `===== Page N =====` markers, so an image-only PDF still exits 0 with markers and no body text when pypdf is the engine; the markers-only output is the no-text signal on that path. Exit code 2 fires on the pdftotext path.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
