# Vendored browser assets

- `force-graph.min.js` — [force-graph](https://github.com/vasturiano/force-graph) v1.51.4 UMD build
  (MIT, see `force-graph.LICENSE.md`), fetched from
  `https://unpkg.com/force-graph@1.51.4/dist/force-graph.min.js`.
  Inlined verbatim into every generated canvas artifact so the graph renders
  offline inside the sandboxed iframe (no CDN at view time).
  To upgrade: bump the URL version, re-download, and re-run the kg tests.
