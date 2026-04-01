Firestore setup in this backend

1. Copy .env.example to .env
2. Fill FIREBASE_PROJECT_ID (optional if present in service-account JSON)
3. Choose one credential option:
   - FIREBASE_SERVICE_ACCOUNT_JSON (inline JSON)
   - FIREBASE_SERVICE_ACCOUNT_PATH (path to service-account file)
   - GOOGLE_APPLICATION_CREDENTIALS (same behavior as FIREBASE_SERVICE_ACCOUNT_PATH)
4. Start server with npm start
5. Check Firestore connection with GET /api/health/firestore

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
