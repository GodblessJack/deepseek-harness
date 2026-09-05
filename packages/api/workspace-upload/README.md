---
description: "Authenticated workspace file upload endpoint: one POST stores an admitted PDF under the session workspace uploads/ tree."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-upload

English | [中文](README.zh.md)

## Summary

`dsh-workspace-upload` owns one Host HTTP endpoint: `POST /api/workspace.upload` receives a multipart `file` field, admits it against the upload policy, and stores it under the calling session's workspace `uploads/` directory. The Composer attachment surface POSTs to this endpoint so a user-provided document becomes a workspace file the session can reference in the prompt. Setup and usage come first; implementation details follow.

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

Use this package when a Web deployment should let a client place one user-provided file into a session workspace. It requires Connection and the live session store (`dsh-session`). The endpoint is a feature-owned exact Fetch route: Connection applies its Host/Origin fence and browser-session authentication before this package sees the request.

### When to choose it

Choose it for browser-driven file intake into the session workspace. Avoid it for programmatic or Host-side file placement: workspace filesystem tools already write files, and ACP/JSON-RPC clients have no transport for this endpoint.

### Composition

```yaml
- id: workspace-upload
  name: '@deepseek-ai/dsh-workspace-upload'
```

The Web bundle mounts the package beside Connection and `dsh-session`.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxFileBytes` | `20971520` | Per-file byte cap for one admitted upload. |

### Endpoint contract

| Request | Response |
|---|---|
| `POST /api/workspace.upload?sessionId=<id>` with multipart field `file` | `200 {"path":"uploads/<name>","bytes":N}` |
| Missing or empty `sessionId` | `400` plain text |
| Body is not multipart form data, or the `file` field is absent or not a file | `400` plain text |
| Leading bytes of the file are not `%PDF-` | `400` `only PDF files are accepted` |
| No live session with the id | `404` `session not found` |
| File larger than `maxFileBytes` | `413` plain text |
| `sessions` service absent, session has no workspace cwd, or the workspace write failed | `500` plain text |

### What to expect

The stored filename is one safe segment: submitted separators (`/`, `\`), `.`, and `..` segments drop, and the remaining segments join with `-`; a name that reduces to nothing becomes `upload.pdf`. An existing file with the same name is never overwritten — the endpoint stores `stem-1.ext`, `stem-2.ext`, and so on, and an extensionless name gains `.pdf` on disambiguation. The response `path` is the stored location relative to the workspace cwd, always inside `uploads/`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the package admits one upload and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design split

One Host half ([`src/index.ts`](src/index.ts)) registers the exact `POST /api/workspace.upload` route on Connection. There is no browser half: the Composer attachment surface POSTs with the browser's ordinary `fetch`, so this package needs no client plugin.

### Admission order

The handler validates the `sessionId` query parameter, resolves the live session through `ctx.get('sessions')`, reads `session.header.cwd` as the workspace root, then parses the multipart body. Admission checks the `file` field, the leading `%PDF-` magic bytes, and the configured byte cap before any filesystem write. The target path resolves under `<cwd>/uploads/` and passes a lexical containment assert against the workspace root before the write; filename sanitization already removed separators and parent segments, so the assert is a defense-in-depth invariant that fails the request with 500 rather than storing outside the workspace. The write opens each candidate filename with exclusive-create semantics, so a taken name — including one taken by a concurrent same-name upload — advances to the next disambiguated candidate instead of being overwritten.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the HTTP carrier to the session workspace it writes into.

- [dsh-client-connection](../../client/connection/README.md) — the authenticated Fetch-route carrier the endpoint registers on.
- [dsh-session](../../core/session/README.md) — the live session store and the workspace cwd the upload resolves against.
- [API package map](../README.md) — the Remote layer this package belongs to.

-----

<a id="model-experience"></a>
## Model Experience

### Workspace upload endpoint

#### What the model sees

The endpoint itself reaches no model. The composer reference text an upload enables — the workspace-relative `path` from the response, inserted into a later prompt by the Composer attachment surface — is model-visible input in that turn's user message.

#### Token effect

Uploading adds zero tokens. The reference text carried into a later prompt counts as ordinary user-message tokens on the turn that includes it.

#### KV Cache effect

None beyond that turn's ordinary user-message prefix change; the upload itself does not alter the derived request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this package is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **No ACP or JSON-RPC transport** — the endpoint is an exact Connection Fetch route on the Web `/api` carrier; ACP and JSON-RPC clients cannot upload files through it.
- **PDF-only admission** — the file must start with the `%PDF-` magic bytes; other formats (and PDFs whose header does not lead the file) answer 400.
- **20 MiB default per-file cap** — `maxFileBytes` defaults to `20971520`; larger uploads answer 413 until the deployment raises the cap.
- **Live sessions only** — the workspace root comes from the live session store; a session id that is not currently live answers 404.
- **Cookie authentication is not bound to the target sessionId** — any request that passes Connection's browser-session authentication can write into any live session's workspace; this is a single-user deployment assumption, and multi-user deployments need session-scoped binding.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked pages.

#### Future: admission beyond PDF

The `%PDF-` magic gate matches the first Composer attachment milestone; admitting other formats needs a format list decision and per-format reference behavior in the Composer surface.

</details>
