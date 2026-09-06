# @deepseek-ai/dsh-host-kg

[English](README.md) | 中文

DeepSeek Harness 的知识图谱宿主插件。`KgService` 注册 `ctx.kg` 服务与面向模型的 `kg_graph` 工具:列出 RAGFlow 全部知识库、逐库拉取知识图谱、组装成一张「中心 → 知识库 → 实体」的汇聚大图,经公开的 `ctx.canvas.write` 写入画布。浏览器侧零改动:现有画布面板离线渲染这份自包含 HTML 作品。

## 工具

`kg_graph(library?: string)` 命中「打开知识图谱」「展示图谱关系」「全局知识大图」等说法时触发。不带参数组装全部知识库;`library`(名称或 id)只看单库。结果文本报告库/实体/关系计数与单库失败情况;作品落画布时已自动选中。

## 数据流

```text
credentials.resolve(RAGFLOW_API_URL / RAGFLOW_API_KEY)   per call, references only
GET /api/v1/datasets                                     list libraries
GET /api/v1/datasets/{id}/graph                          per library, in parallel
normalizeLibraryGraph                                    merge name+type duplicates, drop dangling edges
assembleHub                                              whitelist + top-N policy, hub structure
renderKgHtml                                             vendored force-graph + embedded data island
ctx.canvas.write                                         one html artifact, selected
```

## 配置(cordis.yml)

| 字段 | 默认 | 含义 |
|---|---|---|
| `apiUrlEnv` | `RAGFLOW_API_URL` | RAGFlow 服务地址的凭据引用——只是引用,绝不存值 |
| `apiKeyEnv` | `RAGFLOW_API_KEY` | API Key 的凭据引用 |
| `hubLabel` | `知识图谱` | 中心节点文字 |
| `libraries` | `[]` | 空 = 全部知识库;否则为名称/id 白名单 |
| `maxNodesPerLibrary` | `0` | 0 保留全部实体;更大值每库按连接数保留前 N |
| `titlePrefix` | `DSH` | 画布作品标题前缀 |

## 失败语义

每次失败都在工具结果里响亮且可执行:凭据缺失点名具体 env 引用与配置位置;RAGFlow 列库失败报告当前 URL;单库失败渲染为红色节点并附原因,其余库不受影响;未构建图谱的库显示 `empty` 徽标。跨库同名实体绝不合并——hover 卡片提示该名称还出现在哪些库。

## 内嵌资产

`assets/force-graph.min.js` 是 force-graph 的 UMD 构建(MIT),逐字内嵌进每份作品,使沙箱画布 iframe 无需联网。版本锁定与升级方式见 `assets/README.md`。

## 测试

`tests/kg.spec.ts` 覆盖 normalize/组装纯函数、渲染 HTML 契约(数据岛、引擎内嵌、`<script>` 中和)、以及经 mock RAGFlow 服务器的工具行为(凭据缺失、列库失败、混合库结果、单库聚焦、全空)。`tests/invariant.spec.ts` 注册本包的(空)invariant 伴随——全部持久状态都归作品存储所有。
