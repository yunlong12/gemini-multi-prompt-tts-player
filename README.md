# Gemini Multi-Prompt TTS Player

A full-stack app for generating grounded news/text answers with Gemini, converting them to speech, and playing both manual results and scheduled runs from a unified player UI.

## What It Does

- Accepts multiple prompts and generates grounded answers with Gemini plus Google Search
- Converts answers to speech and plays them in the browser
- Stores prompt history locally for manual runs
- Supports admin login, schedules, run history, and Cloud Scheduler polling
- Stores scheduled run artifacts in Google Cloud Storage
- Prefetches scheduled audio into local IndexedDB cache for reuse after refresh

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Express
- AI: Gemini text generation and TTS
- Persistence: Firestore and Google Cloud Storage
- Deployment: Google Cloud Run + Cloud Scheduler

## Local Development

Prerequisites:

- Node.js 18+

Install dependencies:

```bash
npm install
```

Create a local env file:

```bash
cp .env.example .env.local
```

Set the required values in `.env.local`:

- `GEMINI_API_KEY`
- `API_BASE_URL` if you are pointing the frontend at a non-default backend

Start the app:

```bash
npm run dev
```

## Production And Deployment

The app is designed to run on Google Cloud Run.

Deployment reference:

- [google-cloud-deploy-guide.txt](./google-cloud-deploy-guide.txt)

Infrastructure used by the deployed app:

- Cloud Run for the web app and API
- Firestore for schedules and run metadata
- Firestore for global daily rate-limit counters
- Cloud Storage for generated JSON and WAV artifacts
- Cloud Scheduler for polling due schedules

## Security

The current codebase includes these protections:

- Admin login uses signed `HttpOnly` cookie sessions
- Manual text generation and TTS endpoints require an authenticated admin session
- State-changing browser requests are protected by same-origin `Origin`/`Referer` checks
- Scheduled artifacts are served only to authenticated admin sessions
- Artifact path traversal is blocked in the storage layer
- Global daily limits are enforced in Firestore:
  - login: `100/day`
  - text generation: `200/day`
  - tts generation: `200/day`

Important runtime env vars for production:

- `ADMIN_SESSION_SECRET`
- `SCHEDULER_SHARED_SECRET`
- `ALLOWED_ORIGINS`
- `FIRESTORE_COLLECTION_RATE_LIMITS`

## Player Behavior

The unified player supports both manual results and successful scheduled runs.

- Scheduled audio prefetch runs top-down, one item at a time
- Each scheduled item shows a cache state:
  - `Queued`
  - `Downloading audio...`
  - `Decoding audio...`
  - `Cached locally`
  - `Failed`
- Cached scheduled audio and text survive refresh until local session data is cleared

## Repository Notes

- Local logs, `.env` files, migrated prompt history, and other machine-specific artifacts are ignored in `.gitignore`
- Scheduled run Firestore indexes are defined in [firestore.indexes.json](./firestore.indexes.json)

## License

MIT. See [LICENSE](./LICENSE).
