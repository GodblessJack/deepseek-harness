---
description: "经过认证的工作区文件上传端点：一次 POST 将获准的 PDF 存入会话工作区的 uploads/ 目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-upload

[English](README.md) | 中文

## 概述

`dsh-workspace-upload` 拥有一个 Host HTTP 端点：`POST /api/workspace.upload` 接收 multipart `file` 字段，按上传策略准入，并将其存入发起调用的会话工作区的 `uploads/` 目录。Composer 附件面向该端点 POST，使一份用户提供的文档成为会话可以在提示词中引用的工作区文件。设置与用法在前，随后说明实现细节。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 Web 部署需要让客户端把一份用户提供的文件放入会话工作区时使用本包。它需要 Connection 与实时会话存储（`dsh-session`）。该端点是业务拥有的精确 Fetch 路由：Connection 先应用 Host/Origin 防栏与浏览器会话认证，请求才会到达本包。

### 何时选择

为浏览器驱动的会话工作区文件录入选择它。程序化或 Host 侧文件落盘应避免使用：工作区文件系统工具已经能写文件，且 ACP/JSON-RPC 客户端没有到达本端点的传输。

### 组合

```yaml
- id: workspace-upload
  name: '@deepseek-ai/dsh-workspace-upload'
```

Web bundle 将本包与 Connection、`dsh-session` 一起挂载。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxFileBytes` | `20971520` | 单个获准上传文件的字节上限。 |

### 端点约定

| 请求 | 响应 |
|---|---|
| `POST /api/workspace.upload?sessionId=<id>`，multipart 字段 `file` | `200 {"path":"uploads/<name>","bytes":N}` |
| `sessionId` 缺失或为空 | `400` 纯文本 |
| 请求体不是 multipart 表单数据，或 `file` 字段缺失、不是文件 | `400` 纯文本 |
| 文件起始字节不是 `%PDF-` | `400` `only PDF files are accepted` |
| 没有该 id 的实时会话 | `404` `session not found` |
| 文件超过 `maxFileBytes` | `413` 纯文本 |
| `sessions` 服务缺失、会话没有工作区 cwd，或工作区写入失败 | `500` 纯文本 |

### 预期行为

存储文件名是单个安全段：提交名中的分隔符（`/`、`\`）、`.` 与 `..` 段被丢弃，其余段以 `-` 连接；完全归零的名字使用 `upload.pdf`。同名文件从不被覆盖——端点依次存储 `stem-1.ext`、`stem-2.ext`，无扩展名的名字在消歧时补上 `.pdf`。响应中的 `path` 是相对工作区 cwd 的存储位置，始终位于 `uploads/` 内。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释本包如何准入一次上传，并指出实现它的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计拆分

一个 Host 半包（[`src/index.ts`](src/index.ts)）向 Connection 注册精确的 `POST /api/workspace.upload` 路由。没有浏览器半包：Composer 附件面用浏览器普通 `fetch` POST，本包不需要客户端插件。

### 准入顺序

处理器先校验 `sessionId` 查询参数，经 `ctx.get('sessions')` 解析实时会话，读取 `session.header.cwd` 作为工作区根，然后解析 multipart 请求体。准入在写文件系统之前依次检查 `file` 字段、起始 `%PDF-` 魔数与配置的字节上限。目标路径解析到 `<cwd>/uploads/` 之下，并在写入前通过相对工作区根的词法包含断言；文件名消毒已经移除分隔符与父段，因此该断言是纵深防御不变量，失败时以 500 拒绝请求而非把文件存到工作区之外。写入以独占创建语义打开每个候选文件名，名字已被占用——包括被一次并发的同名上传占用——时推进到下一个消歧候选，而不是覆盖既有文件。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从 HTTP 载体进入它写入的会话工作区。

- [dsh-client-connection](../../client/connection/README.zh.md)——端点注册所在的认证 Fetch 路由载体。
- [dsh-session](../../core/session/README.zh.md)——实时会话存储与上传所解析的工作区 cwd。
- [API 包映射](../README.zh.md)——本包所属的 Remote 层。

-----

<a id="model-experience"></a>
## 模型体验

### 工作区上传端点

#### 模型看到什么

端点本身不触达任何模型。上传所启用的 Composer 引用文本——来自响应的工作区相对 `path`，随后由 Composer 附件面插入提示词——是那一轮用户消息中的模型可见输入。

#### Token 影响

上传本身增加零 token。进入后续提示词的引用文本按携带它的那一轮的普通用户消息 token 计。

#### KV Cache 影响

除该轮普通用户消息前缀变化外无影响；上传本身不改变派生请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本包何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是任务积压。

- **没有 ACP 或 JSON-RPC 传输**——端点是 Web `/api` 载体上的精确 Connection Fetch 路由；ACP 与 JSON-RPC 客户端无法经它上传文件。
- **仅准入 PDF**——文件必须以 `%PDF-` 魔数起始；其他格式（以及文件头不位于起始处的 PDF）返回 400。
- **默认 20 MiB 单文件上限**——`maxFileBytes` 默认 `20971520`；超过上限的上传返回 413，直到部署调高上限。
- **仅实时会话**——工作区根来自实时会话存储；当前不在存储中的会话 id 返回 404。
- **Cookie 认证不与目标 sessionId 绑定**——任何通过 Connection 浏览器会话认证的请求都能写入任意实时会话的工作区；这是单用户部署假设，多用户部署需要会话级绑定。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放设计问题与尚未决定的探索方向。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码和相关页面为准。

#### 未来：PDF 之外的准入

`%PDF-` 魔数门对齐 Composer 附件的第一个里程碑；准入其他格式需要格式清单决策以及 Composer 面上逐格式的引用行为。

</details>
