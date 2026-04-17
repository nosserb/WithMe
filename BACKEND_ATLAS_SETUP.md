Firestore setup in this backend

1. Copy .env.example to .env
2. Fill FIREBASE_PROJECT_ID (optional if present in service-account JSON)
3. Choose one credential option:
   - FIREBASE_SERVICE_ACCOUNT_JSON (inline JSON)
   - FIREBASE_SERVICE_ACCOUNT_PATH (path to service-account file)
   - GOOGLE_APPLICATION_CREDENTIALS (same behavior as FIREBASE_SERVICE_ACCOUNT_PATH)
4. Start server with npm start
5. Check Firestore connection with GET /api/health/firestore

GitHub Pages frontend + backend API

- GitHub Pages cannot run Node/Express. You must host the backend separately (Render, Railway, Fly.io, VPS, etc.).
- Configure the frontend API endpoint with one of these methods:
   - Open login page with query param: `https://nosserb.github.io/WithMe/login.html?apiBaseUrl=https://your-backend.example.com`
   - Or in browser console: `window.WithMeRuntimeConfig.setApiBaseUrl("https://your-backend.example.com")`
- The URL is persisted in localStorage (`WithMe-api-base-url`) and reused on next visits.
- Clear it with: `window.WithMeRuntimeConfig.clearApiBaseUrl()`

Variables to fill in .env

- FIREBASE_PROJECT_ID: your Firebase/GCP project id (optional)
- FIREBASE_SERVICE_ACCOUNT_JSON: full service account JSON on one line (optional)
- FIREBASE_SERVICE_ACCOUNT_PATH: absolute path to service-account JSON file (optional)
- GOOGLE_APPLICATION_CREDENTIALS: absolute path to service-account JSON file (optional alias)

Important

- Provide exactly one credentials option (JSON string or path).
- FIREBASE_SERVICE_ACCOUNT_JSON from GitHub Secrets is supported directly.
- Keep service account files out of git.
- If you use FIREBASE_SERVICE_ACCOUNT_JSON, escape newlines in private_key with \\n

Current data mode

- SQLite files are not used anymore.
- Runtime uses in-memory SQLite only.
- Persistent storage is Firestore (loaded at startup, mirrored on writes).

Security notes

- Never commit .env
- Never commit service account keys
- Rotate credentials if they are ever exposed

Make server public (not local only)

1. Deploy backend on a public host (Render/Railway/Fly.io/VPS).
2. Set env vars on host:
   - `WITHME_DEPLOY_MODE=hosted`
   - `PORT` (provided automatically by most hosts)
   - `FIREBASE_PROJECT_ID`
   - one credentials option: `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_PATH`
   - `CORS_ALLOWED_ORIGINS=https://nosserb.github.io` (or your custom frontend domain)
3. Start command: `npm start`
4. Check API health:
   - `/api/health`
   - `/api/health/firestore`
5. Connect GitHub Pages frontend to this backend URL:
   - open `https://nosserb.github.io/WithMe/login.html?apiBaseUrl=https://your-backend.example.com`

Notes

- In hosted mode, backend serves plain HTTP internally and platform TLS handles HTTPS publicly.
- Locally, if cert files exist, app still runs in HTTPS dev mode as before.
