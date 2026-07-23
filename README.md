# 码藏

把网页长文与在线文档，收成可带走的 Markdown。

Chrome / Edge 扩展：一键导出 **飞书 / Lark 文档**、**生财有术**帖子、**X 长文** 为 Markdown / HTML / Word / PDF。

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)

## 功能

- 飞书文档、生财有术帖子、X 长文 / 帖子 → **Markdown / HTML / Word(.doc) / PDF**
- 富文本还原：标题、列表、待办、引用、代码、表格、图片、样式等（表格 / 公式为尽力支持）
- 图片可内嵌（base64，单文件自包含）
- **批量导出**、**导出历史**
- **转存到飞书**（需自配飞书开放平台应用）
- 侧边栏 + 页面悬浮球 + 设置页
- 数据全部在本机处理，不上传第三方服务器

## 安装（开发者模式）

1. 克隆本仓库：
   ```bash
   git clone https://github.com/DarioLee555/macang.git
   cd macang
   ```
2. 打开 Chrome / Edge → `chrome://extensions/` → 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本仓库根目录（含 `manifest.json` 的那一层）

完整说明见 [使用说明.md](./使用说明.md)。

## 使用

1. 打开已登录的飞书文档 / 生财有术帖子 / X 长文页
2. 点击工具栏 **「藏」** 图标打开侧边栏（或使用页面右下角悬浮球）
3. 选择格式 → 导出

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

- 新站点适配（在 `src/shared/sites.js` + `src/injected/extractor.js`）
- 导出保真度修复（嵌套列表、图片、表格等）
- 文档与翻译

提交前请在目标站点各测至少一篇样例页。

## 免责声明

本项目仅供个人学习与合法备份自己有权访问的内容。请遵守各网站服务条款与当地法律法规；勿用于未授权抓取或传播他人内容。

## License

[MIT](LICENSE)
