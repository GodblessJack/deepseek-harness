# @deepseek-ai/dsh-client-ui-canvas

English | [中文](README.zh.md)

Browser half of the canvas side panel: the right-side artifact panel and the per-work conversation card. It consumes the `canvas` Host Remote from [`@deepseek-ai/dsh-host-canvas`](../../host/canvas/README.md) through the `api-remotes` assembly and renders two slots:

- `details` — the right-side panel with artifact tabs, the selected artifact's viewer (HTML sandbox iframe, local Markdown renderer with pipe tables, or plain text), and one download link per recorded attachment. A panel header carries close, download (artifact body through `GET /api/canvas.artifact`), copy, and print actions; printing opens a new tab with the artifact (HTML verbatim, markdown rendered through the panel renderer) and triggers the browser print dialog.
- `tool.call.toolview` key `canvas` — a conversation card per canvas tool call, clickable to open that artifact in the panel.

The browser plugin declares no host-side behavior; it ships via `exports["./client"]` and the `dsh.client` manifest, composed through the `dsh-web-app` bundle roster.

```yaml
- id: ui-canvas
  name: '@deepseek-ai/dsh-client-ui-canvas'
```

## Data and lifecycle

One `CanvasController` per Session wraps the generated `remote.canvas` face and the details-column open/close verbs. The panel polls `canvas.state` on a 1-second interval while mounted (summaries only — the selected artifact's content is fetched when the revision or selection changes); the card parses the settled tool result text for the artifact identity and auto-opens the panel once per write. Artifact attachments from the polled state become download links through the carrier's `GET /api/canvas.attachment` endpoint (PDF attachments are labeled 下载 PDF); a missing file answers 404 from the carrier, which the browser surfaces as its own download error. All state remains in the Host store; a page refresh re-polls the Host and re-renders whatever the Session still holds.

## Model Experience

None, as this browser-only plugin registers no prompt, tool, message, or provider request. It renders Host-owned tool output; nothing here enters model input.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Poll-based panel** — the details panel polls on a fixed 1-second interval rather than subscribing to a push channel; the Host owns no event stream for canvas mutations. The poll carries summaries without content; content is refetched per revision or selection change.
- **Card parsing is message-text coupled** — the conversation card derives the artifact id from the canvas tool's settled message text; a Host-side message format change must be mirrored here.
- **Attachment links assume the carrier mount** — the download URL targets the web carrier's `/api/canvas.attachment`; other carriers (ACP, JSON-RPC) get the attachment metadata but no transport path of their own.
