# Gemini Multi-Prompt TTS Player

A full-stack app for generating grounded news/text answers with Gemini, converting them to speech, and playing both manual results and scheduled runs from a unified player UI.

## What It Does

- Accepts multiple prompts and generates grounded answers with Gemini plus Google Search
- Converts answers to speech and plays them in the browser
- Stores prompt history locally for manual runs
- Supports admin login, schedules, run history, and Cloud Scheduler polling
- Stores scheduled run artifacts in Google Cloud Storage

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
- Cloud Storage for generated JSON and WAV artifacts
- Cloud Scheduler for polling due schedules

## Repository Notes

- Local logs, `.env` files, migrated prompt history, and other machine-specific artifacts are ignored in `.gitignore`
- Scheduled run Firestore indexes are defined in [firestore.indexes.json](./firestore.indexes.json)

## License

MIT. See [LICENSE](./LICENSE).
