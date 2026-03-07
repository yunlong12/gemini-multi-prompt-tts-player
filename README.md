# Gemini Multi-Prompt TTS Player

English | [中文说明](#中文说明)

Gemini Multi-Prompt TTS Player is a full-stack app for generating grounded text answers with Gemini, turning them into speech, and managing both manual and scheduled audio runs from one interface.

## English

### Overview

This app combines five workflows in one place:

- Admin-authenticated manual text generation
- Admin-authenticated TTS generation
- A unified browser audio player for manual and scheduled runs
- Schedule management for recurring prompts
- Scheduled run storage and playback through Google Cloud

The current app is designed for a single admin password workflow. There is no multi-user account system.

### Main Features

- Enter multiple prompts at once, one prompt per line
- Generate grounded answers with Gemini plus Google Search grounding links
- Convert generated answers into speech with Gemini TTS
- Play manual results and scheduled runs in one shared player
- Store manual history locally in the browser
- Manage schedules, run them immediately, and review scheduled run history
- Cache scheduled audio locally after download for faster replay

### How To Use The App

#### 1. Sign in

Manual text generation, manual TTS generation, schedule management, scheduled run history, and artifact downloads all require an authenticated admin session.

To sign in:

1. Open the app in your browser.
2. Enter the admin password.
3. Click `Sign In`.

After login, the app stores a signed `HttpOnly` session cookie in the browser.

#### 2. Generate manual prompts

Use the `Input Prompts` section at the top of the page.

Steps:

1. Select a TTS model:
   - `Gemini 2.5 Pro TTS (High Quality)`
   - `Gemini 2.5 Flash TTS (Faster)`
2. Enter one prompt per line.
3. Click `Generate & Prepare Audio`.

What happens next:

1. Each prompt is queued.
2. The app requests grounded text from `/api/text`.
3. The app requests speech audio from `/api/tts`.
4. The returned audio is decoded in the browser.
5. The result becomes available in Results, History, and Player.

If multiple prompts are entered, they are processed one by one.

#### 3. Review recent results

The `Results` tab shows recent manual results from the last hour.

Each result can include:

- The original prompt
- The generated answer
- Grounding links
- Current processing state

The `Activity Log` panel shows request and playback events to help debug generation flow.

#### 4. Use the unified player

Open the `player` tab to play all available audio from one interface.

The unified player supports:

- Manual runs generated in the current browser session
- Successful scheduled runs downloaded from the server

Typical actions:

- Select an item to inspect prompt text and body text
- Play or pause the current item
- Play selected items as a sequence
- Download audio where available
- Open grounding links

Scheduled audio cache states may include:

- `Queued`
- `Downloading audio...`
- `Decoding audio...`
- `Cached locally`
- `Failed`

Scheduled audio is prefetched top to bottom, one item at a time.

#### 5. Use local history

Open the `history` tab to view local browser history.

History includes:

- Manual runs stored in IndexedDB
- Scheduled runs that have been cached locally

You can:

- Review prompt and output text
- Play an item from history
- Select multiple entries
- Delete one or many entries

Notes:

- Manual history is local to the browser profile on that device.
- Scheduled runs only appear here after they have been loaded or cached locally.

#### 6. Manage schedules

Open the `schedules` tab after signing in.

You can create or edit schedules with these fields:

- `Name`
- `Timezone`
- `Prompt Template`
- `Frequency`
  - `Daily`
  - `Weekly`
  - `Custom Interval`
- `Time`
- `Days of Week` for weekly schedules
- `Interval Minutes` for custom intervals
- `TTS Model`
- `Output Prefix`
- `Enabled`

Prompt templates support:

- `{{today}}`
- `{{yesterday}}`
- `{{timezone}}`

Available schedule actions:

- Create a new schedule
- Update an existing schedule
- Delete a schedule
- Run a schedule immediately with `Run`
- Refresh schedule and run data

#### 7. Review scheduled runs

Open the `runs` tab after signing in.

You can:

- See the latest scheduled runs
- Review run status: `running`, `success`, or `error`
- Read generated text or error details
- Open stored JSON artifacts
- Play or download stored audio

Scheduled artifacts are protected and require an authenticated admin session.

### Local Development

#### Requirements

- Node.js 18 or newer

#### Install

```bash
npm install
```

#### Create local environment file

```bash
cp .env.example .env.local
```

Set the required values in `.env.local`:

- `GEMINI_API_KEY`
- `APP_ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `SCHEDULER_SHARED_SECRET`

Optional local settings include:

- `APP_DEFAULT_TIMEZONE`
- `ALLOWED_ORIGINS`
- `ADMIN_SESSION_TTL_MS`
- `GCS_BUCKET_NAME`
- Firestore collection names

#### Start frontend development

```bash
npm run dev
```

#### Start backend locally

```bash
npm run dev:api
```

By default:

- Vite serves the frontend
- Express serves the backend
- The backend reads `.env.local`

### Production Deployment

The app is designed to run on Google Cloud Run.

See the deployment guide here:

- [google-cloud-deploy-guide.txt](./google-cloud-deploy-guide.txt)

Current production architecture:

- Cloud Run for the app and API
- Firestore for schedules, runs, and daily rate-limit counters
- Google Cloud Storage for scheduled audio and JSON artifacts
- Cloud Scheduler for polling due schedules

Important runtime variables:

- `ADMIN_SESSION_SECRET`
- `APP_ADMIN_PASSWORD`
- `SCHEDULER_SHARED_SECRET`
- `ALLOWED_ORIGINS`
- `GCS_BUCKET_NAME`
- `FIRESTORE_COLLECTION_RATE_LIMITS`

### Security Notes

Current protections include:

- Signed `HttpOnly` admin session cookies
- Manual text and TTS generation require admin authentication
- Same-origin `Origin`/`Referer` checks on state-changing browser requests
- Auth-required access for scheduled artifacts
- Artifact path traversal protection
- Global daily Firestore-backed rate limits

Default daily limits:

- login: `100/day`
- text generation: `200/day`
- TTS generation: `200/day`

### Repository Notes

- `.env` files, local logs, local exports, and machine-specific artifacts are ignored by git
- Scheduled run indexes are defined in [firestore.indexes.json](./firestore.indexes.json)

### License

MIT. See [LICENSE](./LICENSE).

---

## 中文说明

### 应用简介

Gemini Multi-Prompt TTS Player 是一个前后端一体的应用，用来完成以下工作：

- 管理员登录后手动输入多个 Prompt
- 调用 Gemini 生成带搜索依据的文本答案
- 调用 Gemini TTS 把文本转成语音
- 在统一播放器里播放手动结果和定时任务结果
- 管理定时任务，并查看定时运行历史

当前应用采用“单管理员密码”模式，不是多用户系统。

### 主要功能

- 一次输入多条 Prompt，每行一条
- 生成带 grounding links 的 Gemini 文本结果
- 把生成结果转成语音
- 在同一个播放器中播放手动生成和定时生成的音频
- 在浏览器本地保存手动历史
- 创建、修改、删除、立即执行定时任务
- 下载并缓存定时任务音频，便于刷新后继续播放

### 如何使用此应用

#### 1. 登录

现在以下功能都需要管理员登录后才能使用：

- 手动文本生成
- 手动 TTS 生成
- 定时任务管理
- 定时运行历史查看
- 定时产物下载

登录步骤：

1. 打开应用页面
2. 输入管理员密码
3. 点击 `Sign In`

登录成功后，浏览器会保存一个签名的 `HttpOnly` 会话 Cookie。

#### 2. 手动生成内容

页面顶部有 `Input Prompts` 区域。

使用方法：

1. 先选择 TTS 模型
   - `Gemini 2.5 Pro TTS (High Quality)`
   - `Gemini 2.5 Flash TTS (Faster)`
2. 在文本框中输入多条 Prompt，每行一条
3. 点击 `Generate & Prepare Audio`

执行流程：

1. 每条 Prompt 先进入队列
2. 前端调用 `/api/text` 获取文本答案
3. 再调用 `/api/tts` 获取语音数据
4. 浏览器解码音频
5. 结果进入 Results、History 和 Player

如果一次输入多条，会按顺序逐条处理。

#### 3. 查看最近结果

`Results` 标签页会显示最近一小时内的手动生成结果。

每条结果通常包含：

- 原始 Prompt
- 生成文本
- grounding links
- 当前处理状态

页面下方的 `Activity Log` 会显示请求、排队、播放等活动日志，便于排查问题。

#### 4. 使用统一播放器

进入 `player` 标签页，可以集中播放所有可用音频。

播放器支持两类内容：

- 当前浏览器里手动生成的音频
- 成功执行的定时任务音频

你可以：

- 选择某一条内容查看 Prompt 和正文
- 播放 / 暂停当前内容
- 按顺序播放多条内容
- 下载音频
- 打开 grounding links

定时音频的缓存状态包括：

- `Queued`
- `Downloading audio...`
- `Decoding audio...`
- `Cached locally`
- `Failed`

定时音频会按从上到下的顺序串行预取，一次只处理一条。

#### 5. 使用本地历史

进入 `history` 标签页，可以查看浏览器本地历史。

这里包含：

- 手动生成并保存在 IndexedDB 里的内容
- 已经被本地缓存过的定时任务内容

你可以：

- 查看标题和文本内容
- 从历史里直接播放
- 多选历史项
- 单条删除或批量删除

说明：

- 手动历史只保存在当前设备、当前浏览器配置里
- 定时任务只有在被加载或缓存后，才会出现在本地历史中

#### 6. 管理定时任务

登录后进入 `schedules` 标签页。

你可以创建或编辑定时任务，字段包括：

- `Name`
- `Timezone`
- `Prompt Template`
- `Frequency`
  - `Daily`
  - `Weekly`
  - `Custom Interval`
- `Time`
- `Days of Week`
- `Interval Minutes`
- `TTS Model`
- `Output Prefix`
- `Enabled`

Prompt 模板支持以下占位符：

- `{{today}}`
- `{{yesterday}}`
- `{{timezone}}`

可执行的操作：

- 新建任务
- 更新任务
- 删除任务
- 点击 `Run` 立即执行一次
- 刷新 schedules 和 runs 数据

#### 7. 查看定时运行记录

登录后进入 `runs` 标签页。

你可以：

- 查看最新的定时运行记录
- 查看运行状态：`running`、`success`、`error`
- 阅读生成文本或错误信息
- 打开保存的 JSON 产物
- 播放或下载保存的音频

这些定时产物需要登录后才能访问。

### 本地开发

#### 环境要求

- Node.js 18 及以上

#### 安装依赖

```bash
npm install
```

#### 创建本地环境变量文件

```bash
cp .env.example .env.local
```

在 `.env.local` 中至少设置：

- `GEMINI_API_KEY`
- `APP_ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `SCHEDULER_SHARED_SECRET`

可选项包括：

- `APP_DEFAULT_TIMEZONE`
- `ALLOWED_ORIGINS`
- `ADMIN_SESSION_TTL_MS`
- `GCS_BUCKET_NAME`
- Firestore collection 名称

#### 启动前端开发环境

```bash
npm run dev
```

#### 启动本地后端

```bash
npm run dev:api
```

默认情况下：

- Vite 提供前端页面
- Express 提供后端 API
- 后端从 `.env.local` 读取配置

### 云端部署

此应用设计为运行在 Google Cloud Run 上。

部署参考文档：

- [google-cloud-deploy-guide.txt](./google-cloud-deploy-guide.txt)

当前生产架构：

- Cloud Run 承载前端和后端
- Firestore 存储 schedules、runs 和每日限流计数
- Google Cloud Storage 存储定时任务生成的 WAV 和 JSON 产物
- Cloud Scheduler 负责轮询到期 schedule

生产环境关键变量：

- `ADMIN_SESSION_SECRET`
- `APP_ADMIN_PASSWORD`
- `SCHEDULER_SHARED_SECRET`
- `ALLOWED_ORIGINS`
- `GCS_BUCKET_NAME`
- `FIRESTORE_COLLECTION_RATE_LIMITS`

### 安全说明

当前代码包含以下保护机制：

- 使用签名的 `HttpOnly` 管理员会话 Cookie
- 手动文本生成和手动 TTS 必须先登录
- 浏览器发起的写操作会校验同源 `Origin` / `Referer`
- 定时任务产物下载需要登录
- 产物路径做了路径穿越保护
- 每日限流计数保存在 Firestore

默认每日限流：

- 登录：`100/day`
- 文本生成：`200/day`
- TTS 生成：`200/day`

### 仓库说明

- `.env`、本地日志、本地导出文件和机器相关文件都被 git 忽略
- Firestore 的定时任务索引定义在 [firestore.indexes.json](./firestore.indexes.json)

### 许可证

MIT，详见 [LICENSE](./LICENSE)。
