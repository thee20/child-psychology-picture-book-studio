# Child Psychology Picture Book Studio

Windows desktop app for children’s psychology picture books and primary-school mental-health lesson prep.

Runs locally (`127.0.0.1`). You bring your own OpenAI-compatible API.

[中文](./README.zh-CN.md) · [Releases](https://github.com/thee20/child-psychology-picture-book-studio/releases)

## Features

**Picture book**

- Import outline (TXT / Markdown / JSON / DOC / DOCX / RTF)
- Write, polish, shorten, rewrite (page or whole book)
- Character anchors, reference sheet, per-page art prompts
- Batch image gen, layout, text styling
- Export PDF / PNG pages / ZIP

**Lesson prep**

- Lesson plan + PPT modes
- Local knowledge base
- Export Word / PowerPoint (needs Office installed)
- Student activity sheet

**Models**

- OpenAI-compatible `/v1/models`
- Text + image models (image UI focuses on Grok / Gemini families)
- API key stays on this PC, not shown in the UI

## Download

From [Releases](https://github.com/thee20/child-psychology-picture-book-studio/releases):

| File | Notes |
| --- | --- |
| `*-Setup-*.exe` | Installer (recommended) |
| `*-Portable-*.zip` | Portable, no install |

Needs Windows 10/11 x64, [Node.js 20+](https://nodejs.org/), [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (usually already there with Edge).

Open the app → **API 接入** → Base URL + API Key.

## Run from source

```powershell
# desktop shell (needs .NET 6 SDK)
powershell -ExecutionPolicy Bypass -File .\生成桌面程序.ps1

# or UI only
node server.js
# http://127.0.0.1:4173
```

Build installer / portable:

```powershell
npm run release
```

## Config

Priority: env vars → in-app API → local WorkBuddy (`%USERPROFILE%\.workbuddy\models.json`).

```powershell
$env:CLI_PROXY_API_KEY = "your-key"
$env:CLI_PROXY_BASE_URL = "https://your-proxy.example/v1"
node server.js
```

| Variable | Meaning |
| --- | --- |
| `CLI_PROXY_API_KEY` | API key |
| `CLI_PROXY_BASE_URL` | OpenAI-compatible base (usually ends with `/v1`) |
| `HOST` / `PORT` | Default `127.0.0.1:4173` |

Keys go in `data/user-api-config.json` (gitignored). Don’t commit real keys. See [`.env.example`](./.env.example).

## Layout

```text
PictureBookStudio.exe  →  http://127.0.0.1:4173
server.js              →  UI + /api/* + model proxy
public/                →  front-end
desktop/               →  WebView2 shell
scripts/               →  Office export, smoke tests
data/                  →  local projects (gitignored)
```

## Dev checks

```powershell
npm run check
npm run smoke
```

## Notes

For local teaching use. Check your model provider’s terms before redistributing. Don’t send sensitive student data to untrusted services.
