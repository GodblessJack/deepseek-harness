# Agent Note: Composer attachment upload (images by picker, PDFs by workspace upload)

Status: implemented

English | [中文](2026-09-06-composer-attachment-upload.zh.md)

## Problem

The Web composer accepted images only through drag-and-drop and paste; there was no click-to-pick entry at all (agent-test ticket: the photo scenario is unreachable on the primary client channel). PDFs and arbitrary files had no channel on any layer: the composer MIME allowlist admits four raster formats, `session.prompt` content parts are text-or-image only, and the DeepSeek adapter has no document part. Users routinely expect a paperclip picker, and report-style PDFs are a first-class input.

## Decision

- **One paperclip button, split by MIME.** A hidden `<input type="file">` next to the `+` command button accepts the four image MIME types plus `application/pdf`. Images keep the existing draft/intake/admission chain untouched; PDFs enter a symmetric file-draft flow (`kind: 'file'` on the `ComposerAttachment` union, no preview probing).
- **Uploads are send-time, workspace-confined, and lazy-parsed.** PDF drafts stay browser-local until submit; `sendSession` then POSTs each through `POST /api/workspace.upload` (a new `packages/api/workspace-upload` endpoint that mirrors the `session.export` direct-endpoint precedent: multipart field `file`, `%PDF-` magic check, 20 MiB cap, containment inside the session workspace `uploads/` tree, `wx` exclusive create with `-N` disambiguation). The admitted prompt's text part leads with one verbatim reference line per file — `[attached file] uploads/<name> (<size>)` — sized with the same formatter the chip renders, so the model-visible line and the UI cannot drift.
- **Parsing is a bundled skill, not a tool or an eager pipeline.** A new `packages/skill/skill-pdf` registers a `pdf` skill provider (the `skill-badge` package shape: assets + provider, rank `BUNDLED_SKILL_RANK`, every session sees it) whose `pdf2text.py` extracts with pypdf first and the system `pdftotext` as fallback, failing loud per exit code: 1 = usage/environment (missing engines state the install hint), 2 = zero extractable text or engine failures. The skill body teaches page-window extraction so long documents never flood the context.
- **Command gates are symmetric with the image gate.** `SubmitEnvelope` gains a required `files` count and all four ui-commands adjudication points refuse file-carrying submissions exactly like image-carrying ones (`input.images: true` never widens to files); claims and typed-line commands both refuse, retaining drafts and text for the user to resolve.
- **Model-visible contract pinned by a recorded Web snapshot.** `snapshots/web/pdf-upload/` records one live turn through the real picker, endpoint, and workspace; replay asserts the file bytes, the verbatim composed prompt, and the typed-line refusal, keyless.

## Alternatives considered

**Extending `session.prompt` with a file content part and widening the attachment seam.** Rejected: `ctx.attachments` is image-only vocabulary, and the change would touch the llm/host/attachment three-party seam for a capability the model cannot consume — DeepSeek chat-completions has no document part.

**Eager host-side parsing at upload time.** Rejected: a large PDF would land whole in the context in one shot; lazy per-window extraction keeps token cost proportional to what the task reads.

**Shipping a first-class `read_pdf` tool.** Rejected for now: one consumer, and the skill shape (SKILL.md + script, the report-writer-toolbox pattern, matching the official anthropics/skills pdf skill) ships with zero new seam surface. Promote to a tool when a second consumer or structured-output need appears.

**Independent plugin packages for the UI/BFF parts.** Rejected: single consumer per part; the work lands inside the existing ui-conversation/ui-attachment plugin packages and follows the repo's one-endpoint-one-package precedent only where that precedent already exists (upload endpoint, skill provider).

## Consequences

- ACP and JSON-RPC clients have no upload transport; the endpoint is a Web-carrier route. Recorded under Known Limitations in the affected READMEs.
- Per-message limits (4 PDFs, 20 MiB each) are front-end pre-checks mirrored from the endpoint defaults; a configured endpoint drift surfaces as a loud 413, not silent acceptance.
- A failed multi-file upload keeps already-admitted files in the workspace; retries store under the next disambiguated name and cleanup is manual (README known limitation).
- The typed-line gate mirrors ui-commands refusal semantics through a stubbed source in ui-conversation tests; end-to-end refusal coverage lives in the Web snapshot scenario.
