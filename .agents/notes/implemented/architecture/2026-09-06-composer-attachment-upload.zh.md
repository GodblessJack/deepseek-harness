# Agent Note:对话框附件上传(图片点选,PDF 落工作区)

Status: implemented

[English](2026-09-06-composer-attachment-upload.md) | 中文

## Problem

Web 对话框只能通过拖拽和粘贴收图片,完全没有点选入口(agent-test 票:主客户端通道的照片场景不可达)。PDF 与任意文件在每一层都没有通道:composer 的 MIME 白名单只收四种光栅格式,`session.prompt` 的 content part 只有 text/image,DeepSeek 适配器没有文档 part。用户普遍期待回形针选择器,报告类 PDF 更是一等输入。

## Decision

- **一个回形针按钮,按 MIME 分流。** `+` 命令按钮旁的内嵌 `<input type="file">` 同时收四种图片 MIME 与 `application/pdf`。图片走既有草稿/摄入/准入链,零改动;PDF 进入对称的文件草稿流(`ComposerAttachment` 联合类型加 `kind: 'file'`,不做尺寸探测)。
- **发送时才上传,限定工作区,懒解析。** PDF 草稿留在浏览器本地直到提交;`sendSession` 逐个 POST 到 `POST /api/workspace.upload`(新包 `packages/api/workspace-upload`,照 `session.export` 直连端点先例:multipart `file` 字段、`%PDF-` magic 校验、20 MiB 上限、限定会话工作区 `uploads/` 目录内、`wx` 独占创建、`-N` 消歧)。准入 prompt 的 text part 以每文件一行 verbatim 引用行开头——`[attached file] uploads/<name> (<size>)`——与 chip 渲染共用同一格式化器,模型可见文本与 UI 不可能漂移。
- **解析做成 bundled skill,不做工具、不做急切管道。** 新包 `packages/skill/skill-pdf` 注册 `pdf` skill provider(skill-badge 包形态:assets + provider,rank `BUNDLED_SKILL_RANK`,所有会话可用),其 `pdf2text.py` 以 pypdf 为主、系统 `pdftotext` 兜底,按退出码 fail loud:1 = 用法/环境(缺引擎时给出安装指引),2 = 无可提取文本或引擎失败。skill 正文教页窗提取,长文档不会一次性灌爆上下文。
- **命令门与图片门对称。** `SubmitEnvelope` 增加必填 `files` 计数,ui-commands 全部四个判定点像拒绝带图提交一样拒绝带文件提交(`input.images: true` 不扩展到文件);菜单 claim 与类型行命令都拒绝,并保留草稿与文本让用户处理。
- **模型可见契约由 Web 录制快照钉住。** `snapshots/web/pdf-upload/` 录一个真实回合,走真实选择器、端点与工作区;replay 断言文件字节、verbatim 组合 prompt 与类型行拒绝,全程 keyless。

## Alternatives considered

**扩 `session.prompt` 加文件 content part、扩 attachment 服务面。** 拒绝:`ctx.attachments` 是 image-only 词汇,改动会牵动 llm/host/attachment 三方 seam,而模型根本消费不了——DeepSeek chat-completions 没有文档 part。

**上传时 host 侧急切解析。** 拒绝:大 PDF 会一次性整体进上下文;懒按页窗提取让 token 成本与任务实际阅读量成正比。

**做一等 `read_pdf` 工具。** 暂缓:只有一个消费者,skill 形态(SKILL.md + 脚本,report-writer-toolbox 模式,与官方 anthropics/skills 的 pdf skill 同构)零新 seam 面即可交付。出现第二个消费者或结构化输出需求时再升级为工具。

**UI/BFF 部分独立插件包。** 拒绝:各部分都只有一个消费者;工作落进既有 ui-conversation/ui-attachment 插件包内,仅在仓库已有先例处跟随先例(上传端点、skill provider 各一小包)。

## Consequences

- ACP 与 JSON-RPC 客户端没有上传通道;该端点是 Web carrier 路由。已记入相关 README 的 Known Limitations。
- 每条消息限制(4 个 PDF、单个 20 MiB)是前端预检,镜像端点默认值;端点配置漂移时表现为响亮的 413,而非静默接受。
- 多文件上传中途失败时已准入的文件留在工作区;重试以下一个消歧名另存,清理靠手动(README known limitation)。
- 类型行门在 ui-conversation 测试里经 stub 源镜像 ui-commands 拒绝语义;端到端拒绝覆盖由 Web 快照场景承担。
