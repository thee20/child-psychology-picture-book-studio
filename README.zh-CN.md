# 儿童心理绘本工坊

Windows 本地程序：做儿童心理绘本，也做小学心理健康备课。

只跑在本地（`127.0.0.1`）。模型接口自己接，OpenAI 兼容即可。

[English](./README.md) · [下载](https://github.com/thee20/child-psychology-picture-book-studio/releases)

## 功能

**绘本**

- 导入大纲（TXT / Markdown / JSON / DOC / DOCX / RTF）
- 写作、润色、精简、重写（单页或整本）
- 角色锚点、设定图、分页出图提示词
- 批量出图、排版、文字样式
- 导出 PDF / 分页 PNG / ZIP

**备课**

- 教案 + PPT 两种模式
- 本地知识库
- 导出 Word / PPT（需本地装了 Office）
- 学生活动单

**模型**

- 兼容 OpenAI 的 `/v1/models`
- 文本 + 图片（图片侧主要看 Grok / Gemini）
- Key 只存在本地，界面不展示

## 下载

到 [Releases](https://github.com/thee20/child-psychology-picture-book-studio/releases) 拿：

| 文件 | 说明 |
| --- | --- |
| `*-Setup-*.exe` | 安装包（推荐） |
| `*-Portable-*.zip` | 绿色版 |

环境：Windows 10/11 64 位、[Node.js 20+](https://nodejs.org/)、[WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)（一般随 Edge 已有）。

打开程序 → **API 接入** → 填 Base URL 和 API Key。

## 源码运行

```powershell
# 桌面壳（需要 .NET 6 SDK）
powershell -ExecutionPolicy Bypass -File .\生成桌面程序.ps1

# 或只跑界面
node server.js
# http://127.0.0.1:4173
```

打安装包 / 便携包：

```powershell
npm run release
```

## 配置

优先级：环境变量 → 应用内 API → 本地 WorkBuddy（`%USERPROFILE%\.workbuddy\models.json`）。

```powershell
$env:CLI_PROXY_API_KEY = "your-key"
$env:CLI_PROXY_BASE_URL = "https://your-proxy.example/v1"
node server.js
```

| 变量 | 含义 |
| --- | --- |
| `CLI_PROXY_API_KEY` | API Key |
| `CLI_PROXY_BASE_URL` | OpenAI 兼容根地址（一般以 `/v1` 结尾） |
| `HOST` / `PORT` | 默认 `127.0.0.1:4173` |

Key 写在 `data/user-api-config.json`（已 gitignore）。别把真 Key 提交进仓库。可参考 [`.env.example`](./.env.example)。

## 目录

```text
PictureBookStudio.exe  →  http://127.0.0.1:4173
server.js              →  界面 + /api/* + 模型代理
public/                →  前端
desktop/               →  WebView2 壳
scripts/               →  Office 导出、冒烟测试
data/                  →  本地项目（gitignore）
```

## 自检

```powershell
npm run check
npm run smoke
```

## 说明

给本地教学用。二次分发前先看清模型服务商条款。敏感学生信息别往不信任的服务里扔。
