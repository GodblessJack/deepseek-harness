# @deepseek-ai/dsh-host-kg

English | [中文](README.zh.md)

Knowledge-graph host for the DeepSeek Harness. `KgService` registers the `ctx.kg` service and the model-facing `kg_graph` tool: it lists every RAGFlow dataset, fetches each dataset's knowledge graph, and assembles one hub artifact — hub → library → entities — written to the canvas through the public `ctx.canvas.write`. The browser half is unchanged: the existing canvas panel renders the self-contained HTML artifact offline.

## Tool

`kg_graph(library?: string)` fires on phrases like 「打开知识图谱」「展示图谱关系」「全局知识大图」. Without arguments it assembles every dataset; with `library` (name or id) it scopes to one. The result text reports library/entity/relationship counts and any per-library failures; the artifact itself lands on the canvas already selected.

## Data flow

```text
credentials.resolve(RAGFLOW_API_URL / RAGFLOW_API_KEY)   per call, references only
GET /api/v1/datasets                                     list libraries
GET /api/v1/datasets/{id}/graph                          per library, in parallel
normalizeLibraryGraph                                    merge name+type duplicates, drop dangling edges
assembleHub                                              whitelist + top-N policy, hub structure
renderKgHtml                                             vendored force-graph + embedded data island
ctx.canvas.write                                         one html artifact, selected
```

## Config (cordis.yml)

| field | default | meaning |
|---|---|---|
| `apiUrlEnv` | `RAGFLOW_API_URL` | credential reference for the RAGFlow base URL — a reference, never a value |
| `apiKeyEnv` | `RAGFLOW_API_KEY` | credential reference for the API key |
| `hubLabel` | `知识图谱` | center-node label |
| `libraries` | `[]` | empty = every dataset; otherwise a name/id whitelist |
| `maxNodesPerLibrary` | `0` | 0 keeps every entity; larger keeps the N most-connected per library |
| `titlePrefix` | `DSH` | artifact title prefix |

## Failure semantics

Every failure is loud and actionable in the tool result: missing credentials name the exact env reference and where to set it; a RAGFlow list failure reports the URL; a failed library renders as a red node with its reason while the rest of the hub stays intact; a library without a built graph shows an `empty` badge. Cross-library same-name entities are never merged — the hover card notes where else a name appears.

## Vendored asset

`assets/force-graph.min.js` is the force-graph UMD build (MIT), inlined verbatim into every artifact so the sandboxed canvas iframe needs no network. See `assets/README.md` for the pinned version and upgrade path.

## Testing

`tests/kg.spec.ts` covers the normalize/assembly pure functions, the rendered HTML contract (data island, engine embedding, `<script>` neutralization), and the tool's behavior through a mock RAGFlow server (missing credentials, list failure, mixed library outcomes, single-library scoping, all-empty). `tests/invariant.spec.ts` registers the package's (empty) invariant companion — the artifact store already owns all durable state.
