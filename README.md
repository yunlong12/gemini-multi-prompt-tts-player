# Gemini Multi-Prompt TTS Player

English | 中文

Gemini Multi-Prompt TTS Player is a full-stack app for generating grounded answers with Gemini, converting them to speech, and managing both manual runs and scheduled runs from one interface.

## English

### Overview

This app combines the following workflows:

- Admin login before entering the app
- Manual prompt generation with Gemini text + TTS
- A unified audio player for manual and scheduled content
- Browser-local history for manual items and cached scheduled items
- Schedule management and scheduled run review
- Cloud-backed storage for scheduled audio and JSON artifacts

The app uses a single admin password model. It is not a multi-user account system.

### Current Login Experience

The app now uses a full-screen login popup flow:

1. When the page loads, the app first checks whether a valid admin session cookie already exists.
2. If a valid session exists, the user enters the app directly.
3. If no valid session exists, a full-screen login popup blocks access to the main UI.
4. After successful login, the popup disappears and the user enters the main app.
5. After manual logout, the app immediately returns to the same full-screen login popup.

The login form is no longer embedded inside the `schedules` or `runs` tabs.

### Main Features

- Enter multiple prompts at once, one prompt per line
- Generate grounded answers with Gemini plus Google Search grounding links
- Convert answers into speech with Gemini TTS
- Review recent manual results
- Play manual and scheduled audio in one shared player
- Store local history in IndexedDB
- Create, edit, delete, and run schedules
- Review scheduled runs and open stored artifacts

### How To Use The App

#### 1. Sign in

Manual text generation, manual TTS generation, schedule management, scheduled run viewing, and artifact downloads require an authenticated admin session.

To sign in:

1. Open the app in your browser.
2. Wait for the session check to finish.
3. If the login popup appears, enter the admin password.
4. Click `Sign In`.

After login, the app stores a signed `HttpOnly` session cookie in the browser.

#### 2. Generate manual prompts

Use the `Input Prompts` section at the top of the app.

Steps:

1. Select a TTS model:
   - `Gemini 2.5 Pro TTS (High Quality)`
   - `Gemini 2.5 Flash TTS (Faster)`
2. Toggle Gemini tools as needed:
   - `Google Search` defaults to on
   - `URL Context` defaults to off
3. Enter one prompt per line.
4. Click `Generate & Prepare Audio`.

What happens next:

1. Each prompt is queued.
2. The app requests grounded text from `/api/text`.
3. The app requests speech audio from `/api/tts`.
4. The returned audio is decoded in the browser.
5. The result becomes available in Results, History, and Player.

If multiple prompts are entered, they are processed one by one.

#### 3. Review recent results

Open the `results` tab.

This view shows recent manual results from the last hour, including:

- Prompt text
- Generated answer
- Grounding links
- Current processing state

The `Activity Log` panel shows request, queue, auth, and playback events.

#### 4. Use the unified player

Open the `player` tab.

The unified player supports:

- Manual runs generated in the current browser session
- Successful scheduled runs loaded from the server and/or local cache

Typical actions:

- Select an item to inspect details
- Play or pause audio
- Play selected items in sequence
- Open grounding links
- Download audio where available

Scheduled audio cache states may include:

- `Queued`
- `Downloading audio...`
- `Decoding audio...`
- `Cached locally`
- `Failed`

Scheduled audio is prefetched top-down, one item at a time.

#### 5. Use local history

Open the `history` tab.

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
- Scheduled runs only appear in local history after they have been loaded or cached locally.

#### 6. Manage schedules

Open the `schedules` tab after signing in.

You can create or edit schedules with these fields:

- `Name`
- `Timezone`
- `Prompt Template`
- `Google Search`
- `URL Context`
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

Prompt templates support:

- `{{today}}`
- `{{yesterday}}`
- `{{timezone}}`

Tool defaults for schedules:

- Existing schedules that do not already store tool settings behave as `Google Search = on`
- Existing schedules that do not already store tool settings behave as `URL Context = off`
- New schedules use the same defaults unless changed in the form

Available schedule actions:

- Create a new schedule
- Update an existing schedule
- Delete a schedule
- Run a schedule immediately with `Run`
- Refresh schedules and runs

#### 7. Review scheduled runs

Open the `runs` tab after signing in.

You can:

- See recent scheduled runs
- Review run status: `running`, `success`, or `error`
- Read generated text or error details
- Open stored JSON artifacts
- Play or download stored audio

Scheduled artifacts require an authenticated admin session.

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

Set at least these values in `.env.local`:

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

Deployment reference:

- [google-cloud-deploy-guide.txt](./google-cloud-deploy-guide.txt)

Before any production deploy, first inspect the existing Google Cloud resources
in the target project. The deployment guide now treats this inspection pass as
mandatory and follows a minimal-change policy: reuse existing Cloud Run
services, service accounts, secrets, buckets, scheduler jobs, and Firestore
where possible, then create only what is missing.

Current production architecture:

- Cloud Run for the web app and API
- Firestore for schedules, scheduled runs, manual async runs, and global rate-limit counters
- Google Cloud Storage for scheduled WAV and JSON artifacts
- Cloud Scheduler for polling due schedules

Important runtime variables:

- `ADMIN_SESSION_SECRET`
- `APP_ADMIN_PASSWORD`
- `SCHEDULER_SHARED_SECRET`
- `ALLOWED_ORIGINS`
- `GCS_BUCKET_NAME`
- `FIRESTORE_COLLECTION_MANUAL_RUNS`
- `FIRESTORE_COLLECTION_RATE_LIMITS`

### Security Notes

Current protections include:

- Signed `HttpOnly` admin session cookies
- Manual text and TTS generation require admin authentication
- Same-origin `Origin`/`Referer` checks on state-changing browser requests
- Auth-required access for scheduled artifacts
- Artifact path traversal protection
- Global Firestore-backed daily rate limits

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

## 中文

### 应用简介

Gemini Multi-Prompt TTS Player 是一个前后端一体的应用，用于：

- 进入应用前先进行管理员登录
- 手动输入多个 Prompt，调用 Gemini 生成文本和语音
- 在统一播放器中播放手动结果和定时任务结果
- 在浏览器本地保存历史
- 管理定时任务，并查看定时执行记录
- 使用云端存储保存定时任务音频和 JSON 产物

当前应用采用“单管理员密码”模式，不是多用户系统。

### 当前登录方式

现在的登录体验已经改成“页面加载后先弹出全屏登录”：

1. 打开网页后，应用会先检查浏览器中是否已有有效的管理员会话。
2. 如果已有有效会话，会直接进入主页。
3. 如果没有有效会话，会显示一个全屏登录弹窗，阻止进入主页。
4. 输入正确密码并登录成功后，弹窗消失，进入应用主页。
5. 手动登出后，会立即回到同样的全屏登录弹窗。

原先放在 `schedules` 和 `runs` 标签页下面的登录区域已经移除。

### 主要功能

- 一次输入多条 Prompt，每行一条
- 调用 Gemini 生成带 grounding links 的文本答案
- 调用 Gemini TTS 把文本转成语音
- 查看最近的手动生成结果
- 在同一个播放器中播放手动和定时音频
- 在 IndexedDB 中保存本地历史
- 创建、修改、删除、立即执行定时任务
- 查看定时运行记录和下载产物

### 如何使用此应用

#### 1. 登录

以下功能都需要管理员登录后才能使用：

- 手动文本生成
- 手动 TTS 生成
- 定时任务管理
- 定时运行记录查看
- 定时产物下载

登录步骤：

1. 打开应用页面。
2. 等待页面完成会话检查。
3. 如果出现全屏登录弹窗，输入管理员密码。
4. 点击 `Sign In`。

登录成功后，浏览器会保存一个签名的 `HttpOnly` 会话 Cookie。

#### 2. 手动生成内容

登录进入主页后，使用顶部的 `Input Prompts` 区域。

操作步骤：

1. 先选择 TTS 模型：
   - `Gemini 2.5 Pro TTS (High Quality)`
   - `Gemini 2.5 Flash TTS (Faster)`
2. 在输入框中填写多条 Prompt，每行一条。
3. 点击 `Generate & Prepare Audio`。

执行流程：

1. 每条 Prompt 会先进入处理队列。
2. 前端调用 `/api/text` 获取 Gemini 文本答案。
3. 再调用 `/api/tts` 获取语音数据。
4. 浏览器负责解码音频。
5. 结果进入 Results、History 和 Player。

如果一次输入多条 Prompt，会按顺序逐条处理。

#### 3. 查看最近结果

进入 `results` 标签页。

这里会显示最近一小时内的手动生成结果，包括：

- 原始 Prompt
- 生成文本
- grounding links
- 当前处理状态

页面下方的 `Activity Log` 会显示请求、排队、认证、播放等活动日志。

#### 4. 使用统一播放器

进入 `player` 标签页。

统一播放器支持两类音频：

- 当前浏览器中手动生成的音频
- 从服务器加载或从本地缓存恢复的定时任务音频

你可以：

- 选择某条内容查看详情
- 播放或暂停音频
- 顺序播放多条内容
- 打开 grounding links
- 下载可用的音频

定时音频的缓存状态包括：

- `Queued`
- `Downloading audio...`
- `Decoding audio...`
- `Cached locally`
- `Failed`

定时音频会按从上到下的顺序串行预取，一次只处理一条。

#### 5. 使用本地历史

进入 `history` 标签页。

这里包含：

- 保存在 IndexedDB 中的手动生成结果
- 已经被本地缓存过的定时任务结果

你可以：

- 查看标题和文本内容
- 从历史里直接播放
- 多选历史项
- 单条删除或批量删除

说明：

- 手动历史只保存在当前设备、当前浏览器配置中。
- 定时任务只有在被加载或缓存后，才会出现在本地历史中。

#### 6. 管理定时任务

进入 `schedules` 标签页。

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

进入 `runs` 标签页。

你可以：

- 查看最近的定时运行记录
- 查看运行状态：`running`、`success`、`error`
- 阅读生成文本或错误信息
- 打开保存的 JSON 产物
- 播放或下载保存的音频

这些定时产物都需要登录后才能访问。

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
