# @deepseek-ai/dsh-host-canvas

English | [中文](README.zh.md)

Host-owned right-side canvas for the DeepSeek Harness. `CanvasService` registers the `ctx.canvas` service, publishes the generated Host Remote contract `canvas.state`, `canvas.get`, `canvas.select`, and `canvas.demo`, exposes the `attachmentStream` download method for the HTTP carrier, and registers the model-facing `canvas` tool. Artifacts are HTML, Markdown, or plain text stored per Session through the storage-domain facility; artifacts may carry downloadable attachments (files in the session workspace). The browser half (`@deepseek-ai/dsh-client-ui-canvas`) polls the Remote for state (artifact summaries without content) and fetches the selected artifact's content when the revision or selection changes.

## Service and Host Remote contract

The service injects the `tools` and `storageDomain` registries. Its three Remote methods are published under the `canvas` namespace:

| method | request | result |
|---|---|---|
| `canvas.state` | `{ sessionId }` | per-session `CanvasState`: artifact summaries (attachments included, content omitted), selection, and a monotonic `rev` |
| `canvas.get` | `{ sessionId, id }` | one artifact's full record including content; a null artifact means the id is unknown |
| `canvas.select` | `{ sessionId, id \| null }` | `{ ok, selected, message }`; `id: null` deselects |
| `canvas.demo` | `{ sessionId }` | `{ ok, message }`; seeds an empty canvas with two demo artifacts |

`state` is direct (no streaming); `select` and `demo` persist their mutation before resolving. Buckets are durable: the `canvas` storage domain keeps one row per Session, so a process restart restores the artifacts and the id counter continues past the persisted maximum. Sessions never share a bucket.

Beside the Remote surface, `attachmentStream(sessionId, artifactId, name)` opens one recorded attachment as a byte stream with its media type and length; the web carrier serves it at `GET /api/canvas.attachment` with a UTF-8 `content-disposition` filename. It resolves `undefined` when the session, artifact, attachment name, or underlying file is unknown (the carrier answers 404). `artifactBodyStream(sessionId, artifactId)` likewise opens the artifact body itself with the kind-derived media type and filename extension, served at `GET /api/canvas.artifact`; it resolves `undefined` for an unknown session or artifact.

## The canvas tool

The plugin registers one model-facing tool named `canvas` on `ctx.tools`. Its arguments mirror the Remote verbs: `op` (`write | update | get | list | select | remove | clear | demo`), optional `id`, `title`, `kind` (`html | markdown | text`), and `content`. Writes and updates select the affected artifact; the tool returns the canonical message text shown in the conversation. `get` returns the artifact content inline and `list` returns a summary of every artifact.

Long-form content may arrive through `contentPath` instead of `content` (mutually exclusive): a file inside the session workspace, at most 2 MiB, read as the artifact content at write time. `write` also accepts `attachments`: a list of `{ name, path }` files inside the session workspace, recorded with size and a media type inferred from the file path (the recorded name stays the download filename); the browser half renders one download link per attachment. Attachment paths and `contentPath` must resolve inside the session workspace — paths escaping it are rejected without recording the artifact. An `update` without `attachments` keeps the prior list.

```yaml
- id: canvas
  name: '@deepseek-ai/dsh-host-canvas'
```

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`canvas` schema](../../../docs/tool-catalog.md#deepseek-aidsh-host-canvas).

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call result

#### What the model sees

Each settled call returns the canonical message text (write/update report the id, title, kind, and byte count, plus the attachment count when attachments were recorded; rejections name the workspace rule violated). The full canvas state lives in the storage domain; the browser half polls it, and no canvas output other than the tool result enters model context.

#### Token effect

One tool-result message per call, bounded by the canonical message text; artifact content never echoes into model context through this package.

#### KV Cache effect

Result text is fixed given the same settled outcome, so it is replay-friendly; no effect of its own beyond the message position.

## Known Limitations and Deferred Work

- **No artifact streaming** — `state` returns every artifact summary on each poll (content omitted; the selected artifact's content is fetched through `get` when the revision changes); large artifacts are bounded only by the storage domain's record size.
- **No cross-session sharing** — each Session owns an isolated bucket by design; sharing artifacts between Sessions is deferred.
- **Attachments are references, not copies** — an attachment records the workspace path at write time; a later download 404s if the workspace file is removed. Copying files into a canvas-owned store is deferred until a deployment needs artifacts to outlive their workspace.
