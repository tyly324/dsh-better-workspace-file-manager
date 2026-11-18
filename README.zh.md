# 工作区文件管理器（增强版）

**中文** · [English](README.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português](README.pt.md)

> **Fork 说明（tyly324）**：本仓库是 [Arrosam/dsh-better-workspace-file-manager](https://github.com/Arrosam/dsh-better-workspace-file-manager) 的 fork，在原版基础上增加了上传目标确认/进度/重试、删除弹窗自动关闭，以及剪切/复制/粘贴、重命名、ZIP 压缩解压、属性、新建文件夹等日常操作。原项目与本文均使用 MIT 许可证。

DSH Web「文件」标签页和文件预览面板的文件管理器，补上官方文件树缺少的写操作；不修改官方 DOM。

## 功能

- **上传**：按钮、拖放或整文件夹拖入；先确认目标目录（选中的文件夹，否则工作区根目录），再显示逐文件进度、失败原因和**重试**。
- **多选**：单击、⌘/Ctrl 单击、Shift 单击、空白处框选。
- **下载**：单文件、多选或整个目录流式打包为 ZIP。
- **新建文件夹**：右键菜单或 header 按钮；目标为最后选中的文件夹，否则根目录。
- **删除**：确认后永久删除；弹窗在成功后一定关闭，行已过期时关闭并提示刷新。
- **剪切 / 复制 / 粘贴 / 重命名**：重名自动 `name (1).ext`，从不覆盖。
- **ZIP 压缩 / 解压**：解压前校验 `..`、绝对路径、符号链接和加密条目。
- **属性**：名称、类型、大小（文件夹为条目数）、修改时间、权限、绝对路径。
- **拖动移动 / 拖入对话**：拖动到文件夹移动，拖入输入框生成 `@path` 引用。
- **预览**：每个预览可下载；文本/代码/Markdown 可就地编辑，保留换行与 BOM，带版本冲突保护，可手动或每 5 秒自动保存。

## 安装

```sh
dsh plugin --profile web add github:tyly324/dsh-better-workspace-file-manager
```

要求：DSH Web profile **0.2.1-rc.3+**（已在 0.2.2-rc.1 验证）、Host 本地文件系统（fs-local / fs-sandbox）、Node.js 20.15+。

## 说明与限制

- 只支持标准 **ZIP**；不支持 ZIP64、加密 ZIP、7z、rar。
- 单文件 / 单包 2 GiB，最多 10000 个条目；更大的任务请用终端。
- 删除是**永久删除**，没有回收站。
- 文件剪贴板只在当前页面内，刷新即清空。
- 文件夹大小显示为直接条目数，不是递归总大小。

## 许可证

MIT，基于 Arrosam/dsh-better-workspace-file-manager；完整英文文档与实现细节见 [README.md](README.md)。
