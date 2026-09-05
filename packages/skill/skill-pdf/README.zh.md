---
description: "随包分发的 pdf skill，供依赖、调优或排查工作区 PDF 文本提取的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-pdf

[English](README.md) | 中文

## 概述

agent（智能体）可以加载随包分发的 `pdf` skill（技能），并遵循其指令，从工作区中的 PDF 文件提取文本——最典型的是经对话输入框上传、落在会话工作区 `uploads/` 树下的附件。该提供方没有配置，并随随附组合以启用状态分发，因此每个会话的 skill 目录都携带 `pdf` 条目。提取由随包分发的 Python 脚本完成：优先 `pypdf`，系统 `pdftotext` 兜底，宿主机两者有其一即可。

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

挂载插件即可让 `pdf` skill 出现在会话 skill 目录中；随后模型会在提取 PDF 文本前凭名称加载它。

### 何时选择

当会话会收到 PDF 文件——上传到工作区 `uploads/` 树下的附件，或工作区中已有的任何 PDF——且模型必须读取其文本时，选择此提供方。随附组合以启用状态携带该行，因为没有它，上传的附件就无法被消费。从不接触 PDF 的部署可以省略或禁用该行。

### 挂载插件

该插件没有配置。它的组合行是：

```yaml
- name: '@deepseek-ai/dsh-skill-pdf'
```

挂载后，`pdf` 会出现在会话目录的可用 skill 中。skill 正文指示模型对 PDF 运行 `assets/scripts/pdf2text.py`，读取重定向出的 `.txt` 输出，并用 `read` 工具分页读取，而不是一次加载整个文档。

### 宿主机要求

脚本只需要宿主机上有下面任意一个 PDF 文本引擎；两个都有也可以。

- `pypdf` —— `pip3 install --user pypdf`（首选引擎；会输出页码标记）
- `poppler-utils` —— 提供 `pdftotext` 可执行文件（兜底引擎）

两者都没有时，脚本以退出码 1 退出，并在 stderr 上打印上面的安装提示；skill 正文要求模型原样报告该提示。

### 可观察的成功与失败

挂载插件会使 `pdf` 出现在目录中并可凭名称加载；销毁后移除。提取成功时文本写入 stdout（退出码 0）。没有引擎能解析的 PDF 会大声失败：引擎错误输出到 stderr（两个引擎都失败后退出码 1）；模型报告失败，而不是猜测内容。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释内置提供方如何接线；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

该提供方是一个不可变、同步注册的 skill 来源：它以 `pdf` 作为提供方名称、按内置 skill rank（600）注册一个固定候选项，把随包分发的 `assets/` 目录作为该 skill 的目录资源基底公开，并在每次加载时从随包分发的 `assets/pdf.md` 文件读取 skill 正文。模型用 skill 加载器渲染出的资源基底来解析 `scripts/pdf2text.py`。

脚本优先 `pypdf`，系统 `pdftotext` 兜底，且从不静默吞掉失败：引擎缺失、解析失败、带密码的 PDF、零文本提取各自产生带 stderr 诊断和独立退出码（0 成功、1 用法/环境、2 无文本）的结果。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口与不可变提供方：一个候选项、资源基底、正文加载 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件 |
| [`assets/pdf.md`](assets/pdf.md) | skill 正文：何时提取与提取流程 |
| [`assets/scripts/pdf2text.py`](assets/scripts/pdf2text.py) | 提取脚本：pypdf 优先、pdftotext 兜底、大声失败 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从该提供方注册到的注册表逐步进入 skill 如何到达模型。

- [skill 子系统参考](../../../docs/subsystems/skills.zh.md)——该提供方实现的注册表与提供方约定。
- [skill 包](../skill/README.zh.md)——该提供方注册到的注册表，以及已加载 skill 的共享渲染。
- [tool-skill 包](../tool-skill/README.zh.md)——pdf skill 如何到达会话目录与模型。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-skill` 间接影响模型；该包会把该提供方的目录条目和所选 skill 的正文渲染给模型。

#### KV Cache 影响

其目录条目和任何已加载正文都会在各自插入点改变提供方的 KV 前缀。提取本身以普通 shell 命令运行，其输出与 token 取决于任务读取的 PDF 页窗口。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明内置提供方不做什么。它们是当前包约束，不是任务积压。

- **固定一个 skill，无运行时自定义**——提供方恰好贡献 `pdf` 这一个 skill；需要其他提取行为的部署请自行编写 skill。
- **OCR 不在范围内**——扫描件或纯图片 PDF 没有可提取文本；退出码 2（或只有页码标记的输出，见下条）就是大声停止。
- **pypdf 零文本细节**——pypdf 路径总会输出 `===== Page N =====` 标记，因此纯图片 PDF 在 pypdf 作为引擎时仍以退出码 0 输出「只有标记、没有正文」；该路径上「只有标记」就是无文本信号。退出码 2 在 pdftotext 路径上触发。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
