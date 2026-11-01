# 码藏

把网页长文与在线文档，收成可带走的 Markdown。

Chrome / Edge 扩展：一键导出 **飞书 / Lark 文档**、**生财有术**帖子、**X 长文** 为 **Markdown / HTML / Word / PDF**。支持批量导出、导出历史，以及转存为新飞书文档。本机处理，不上传。

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-MV3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/)

## 功能一览

| 能力 | 说明 |
|---|---|
| 多站点导出 | 飞书 / Lark 文档、生财有术帖子（含飞书长文块）、X 长文 Article 与普通帖 |
| 多格式 | Markdown、HTML、Word（`.doc`）、PDF |
| 富文本还原 | 标题、段落、列表（含嵌套）、待办、引用、高亮块、代码、表格、图片、加粗/斜体/删除线/下划线/链接等 |
| 图片 | 可选 **内嵌 base64**（单文件自包含）或保留原链接 |
| 批量导出 | 粘贴多行 URL，逐篇后台打开并下载 |
| 导出历史 | 本地记录标题 / 格式 / 时间 / 大小 |
| 转存飞书 | 通过你自己的飞书开放平台应用，新建一篇飞书文档（可选） |
| 交互入口 | 侧边栏主界面 + 页面右下角悬浮球「藏」+ 设置页 |

## 支持范围

| 站点 | 可导出页面 | 提取方式 | 备注 |
|---|---|---|---|
| **飞书 / Lark** | `/docx`、`/docs`、`/wiki`、`/doc` 正文页 | 优先读文档运行时块树（不受虚拟滚动漏块） | 需已登录飞书 |
| **生财有术** | 帖子详情（含 `articleDetail` 长文） | DOM；长文走 `.feishu-doc-content` 块流 | 需已登录生财；嵌套列表 / 图片 / 标题已适配 |
| **X (Twitter)** | `/i/article/…`、`/用户名/article/…`、`/status/…` | DOM（`twitterArticleReadView` 等） | 需已登录 X；Article 需打开正文阅读页 |

### 各格式用途

| 格式 | 适合 |
|---|---|
| **Markdown** | Obsidian / Notion / Git 笔记库 |
| **HTML** | 浏览器阅读、再加工 |
| **Word (.doc)** | 用 Word / WPS 打开编辑 |
| **PDF** | 归档、分享（浏览器内核静默打印生成） |

## 做不到 / 尽力支持

- **表格、块级公式**：尽力还原，复杂排版可能有偏差
- **生财评论区、侧栏推荐**：默认不导出（只导正文）
- **X 未登录 / 登录墙**：无法拿到正文
- **任意网页剪藏**：当前仅白名单站点；通用框选导出尚未做
- **云同步账号**：无；偏好与历史只存在本机浏览器

## 安装（开发者模式）

1. 克隆本仓库：
   ```bash
   git clone https://github.com/dayou555/macang.git
   cd macang
   ```
2. 打开 Chrome / Edge → `chrome://extensions/` → 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本仓库**根目录**（含 `manifest.json` 的那一层）

完整步骤与常见问题见 [使用说明.md](./使用说明.md)。

## 使用

1. 在浏览器打开已登录的飞书文档 / 生财有术帖子 / X 长文页，等页面加载完成
2. 点击工具栏 **「藏」** 图标打开侧边栏（或点页面右下角悬浮球）
3. 选择格式；需要单文件带走时勾选「内嵌图片」
4. 点「导出当前文档」→ 文件进入浏览器默认下载目录

批量：侧边栏 →「批量」→ 每行一个链接 → 开始导出。  
转存飞书：先在设置页填写并测试 App ID / Secret，再点「转存到飞书」。

## 项目结构

```
├── manifest.json          # MV3 扩展清单
├── icons/                 # 扩展图标
├── src/
│   ├── background.js      # Service Worker
│   ├── content/           # 悬浮球
│   ├── injected/          # 页面内提取（MAIN world）
│   ├── sidepanel/         # 侧边栏主界面
│   ├── options/           # 设置页
│   ├── batch/             # 批量导出
│   ├── history/           # 导出历史
│   ├── print/             # PDF 静默打印页
│   └── shared/            # 站点识别等共用逻辑
├── LICENSE
├── README.md
└── 使用说明.md
```

## 隐私

- 导出与转存均在本地浏览器完成
- 不收集、不上传文档内容
- 飞书 App ID / Secret 仅保存在本机 `chrome.storage.local`

## 贡献

欢迎 Issue 与 Pull Request：

- 新站点适配（`src/shared/sites.js` + `src/injected/extractor.js`）
- 导出保真度（嵌套列表、图片、表格、X Article 等）
- 文档与截图

提交前请在目标站点各测至少一篇真实样例页。

## 免责声明

本项目仅供个人学习与合法备份自己有权访问的内容。请遵守各网站服务条款与当地法律法规；勿用于未授权抓取或传播他人内容。

## License

[MIT](LICENSE)
