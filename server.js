const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const { exec } = require("child_process");
const {
  hasFirestoreConfig,
  getFirestoreConfigError,
  getFirestoreRuntimeError,
  pingFirestore,
  mirrorSqliteTables,
  fetchFirestoreTables
} = require("./database/firestore");

ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();
const HTTP_PORT = Number(process.env.PORT || process.env.HTTP_PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const CANONICAL_HOST = process.env.APP_HOST || "127.0.0.1";
const EXTRA_CORS_ORIGINS = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const ALLOWED_CORS_ORIGINS = new Set([
  `https://${CANONICAL_HOST}:${HTTPS_PORT}`,
  `https://localhost:${HTTPS_PORT}`,
  `https://127.0.0.1:${HTTPS_PORT}`,
  "https://nosserb.github.io",
  ...EXTRA_CORS_ORIGINS
]);
const TLS_KEY_PATH = process.env.TLS_KEY_PATH || path.join(__dirname, "certs", "localhost-key.pem");
const TLS_CERT_PATH = process.env.TLS_CERT_PATH || path.join(__dirname, "certs", "localhost-cert.pem");
const DB_PATH = path.join(__dirname, "database", "user.db");
const CHAT_DB_PATH = path.join(__dirname, "database", "chatConcert.db");
const PRIVATE_MESSAGE_DB_PATH = path.join(__dirname, "database", "PrivateMessage.db");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const FIRESTORE_IMAGE_MAX_BYTES = 350 * 1024;

const db = new sqlite3.Database(DB_PATH);
const chatDb = new sqlite3.Database(CHAT_DB_PATH);
const privateMessageDb = new sqlite3.Database(PRIVATE_MESSAGE_DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

function chatRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    chatDb.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function chatGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    chatDb.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });
}

function chatAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    chatDb.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

function privateMessageRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    privateMessageDb.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function privateMessageGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    privateMessageDb.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });
}

function privateMessageAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    privateMessageDb.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

async function initConcertChatDb() {
  await chatRun(`
    CREATE TABLE IF NOT EXISTS concert_messages (
      id SERIAL PRIMARY KEY,
      concert_key TEXT NOT NULL,
      user_id INTEGER,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  await chatRun(`CREATE INDEX IF NOT EXISTS idx_concert_messages_key ON concert_messages(concert_key)`);
  await chatRun(`CREATE INDEX IF NOT EXISTS idx_concert_messages_created ON concert_messages(created_at)`);
}

async function initPrivateMessageDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id SERIAL PRIMARY KEY,
      user_id_a INTEGER NOT NULL,
      user_id_b INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      CHECK(user_id_a < user_id_b)
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_private_messages_pair ON private_messages(user_id_a, user_id_b, created_at)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_private_messages_sender ON private_messages(sender_id, created_at)`);
}

function normalizeConcertKey(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    throw new Error("invalid_concert_key");
  }
  if (value.length > 180) {
    throw new Error("invalid_concert_key");
  }
  if (!/^[a-zA-Z0-9:_|.-]+$/.test(value)) {
    throw new Error("invalid_concert_key");
  }
  return value;
}

async function ensureDefaultConcertDiscussion(concertKey) {
  const existing = await chatGet(
    `SELECT id FROM concert_messages WHERE concert_key = ? LIMIT 1`,
    [concertKey]
  );
  if (!existing) {
    await chatRun(
      `INSERT INTO concert_messages (concert_key, user_id, username, message, created_at) VALUES (?, ?, ?, ?, ?)`,
      [concertKey, null, "WithMe", "Discussion de concert", Date.now()]
    );
  }
}

async function ensureUserProfileColumns() {
  const columns = await all(`PRAGMA table_info(users)`);
  const columnNames = new Set(columns.map((col) => String(col.name || "")));

  if (!columnNames.has("bio")) {
    await run(`ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''`);
  }
  if (!columnNames.has("avatar_url")) {
    await run(`ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''`);
  }
  if (!columnNames.has("banner_url")) {
    await run(`ALTER TABLE users ADD COLUMN banner_url TEXT NOT NULL DEFAULT ''`);
  }
  if (!columnNames.has("avatar_blob")) {
    await run(`ALTER TABLE users ADD COLUMN avatar_blob BYTEA`);
  }
  if (!columnNames.has("avatar_mime")) {
    await run(`ALTER TABLE users ADD COLUMN avatar_mime TEXT NOT NULL DEFAULT ''`);
  }
  if (!columnNames.has("banner_blob")) {
    await run(`ALTER TABLE users ADD COLUMN banner_blob BYTEA`);
  }
  if (!columnNames.has("banner_mime")) {
    await run(`ALTER TABLE users ADD COLUMN banner_mime TEXT NOT NULL DEFAULT ''`);
  }
}

function normalizeExistingUserId(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

async function ensureUsersHaveIds() {
  const rows = await all(`SELECT rowid, id FROM users ORDER BY rowid ASC`);
  let maxId = 0;

  for (const row of rows) {
    const existingId = normalizeExistingUserId(row?.id);
    if (existingId > maxId) {
      maxId = existingId;
    }
  }

  for (const row of rows) {
    const existingId = normalizeExistingUserId(row?.id);
    if (existingId > 0) {
      continue;
    }

    maxId += 1;
    await run(`UPDATE users SET id = ? WHERE rowid = ?`, [maxId, row.rowid]);
  }
}

async function getNextUserId() {
  const row = await get(`SELECT COALESCE(MAX(CAST(id AS INTEGER)), 0) AS max_id FROM users`);
  return Number(row?.max_id || 0) + 1;
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      spotify_id TEXT,
      spotify_display_name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`);

  await run(`
    CREATE TABLE IF NOT EXISTS friendships (
      id SERIAL PRIMARY KEY,
      user_id_a INTEGER NOT NULL,
      user_id_b INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id_a, user_id_b),
      CHECK(user_id_a < user_id_b),
      FOREIGN KEY(user_id_a) REFERENCES users(id),
      FOREIGN KEY(user_id_b) REFERENCES users(id)
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_friendships_user_a ON friendships(user_id_a)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_friendships_user_b ON friendships(user_id_b)`);

  await run(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(sender_id, receiver_id),
      CHECK(sender_id != receiver_id),
      FOREIGN KEY(sender_id) REFERENCES users(id),
      FOREIGN KEY(receiver_id) REFERENCES users(id)
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON friend_requests(sender_id, created_at)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON friend_requests(receiver_id, created_at)`);

  await run(`
    CREATE TABLE IF NOT EXISTS e2ee_user_keys (
      user_id INTEGER PRIMARY KEY,
      public_key_jwk TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS e2ee_private_chat_keys (
      id SERIAL PRIMARY KEY,
      user_id_a INTEGER NOT NULL,
      user_id_b INTEGER NOT NULL,
      key_for_a TEXT NOT NULL,
      key_for_b TEXT NOT NULL,
      algorithm TEXT NOT NULL DEFAULT 'AES-GCM',
      version INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id_a, user_id_b),
      CHECK(user_id_a < user_id_b),
      FOREIGN KEY(user_id_a) REFERENCES users(id),
      FOREIGN KEY(user_id_b) REFERENCES users(id)
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_e2ee_private_chat_pair ON e2ee_private_chat_keys(user_id_a, user_id_b)`);

  await ensureUserProfileColumns();
  await ensureUsersHaveIds();

  await cleanupExpiredSessions();
}

async function cleanupExpiredSessions() {
  await run(`DELETE FROM sessions WHERE expires_at <= $1`, [Date.now()]);
}

function normalizeUserId(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

function normalizeFriendPair(userId1, userId2) {
  const first = normalizeUserId(userId1);
  const second = normalizeUserId(userId2);

  if (!first || !second) {
    return null;
  }
  if (first === second) {
    return null;
  }

  return first < second
    ? { a: first, b: second }
    : { a: second, b: first };
}

function parseStoredEncryptedMessage(rawMessage) {
  const normalized = String(rawMessage || "").trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || parsed.e2ee !== 1) {
      return null;
    }

    const version = Number(parsed.v || 0);
    const algorithm = String(parsed.alg || "");
    const iv = String(parsed.iv || "").trim();
    const ciphertext = String(parsed.ct || "").trim();

    if (version !== 1 || algorithm !== "AES-GCM") {
      return null;
    }
    if (!iv || !ciphertext) {
      return null;
    }

    return {
      version,
      algorithm,
      iv,
      ciphertext
    };
  } catch (error) {
    return null;
  }
}

function normalizeBase64Input(value, fieldName, maxLength = 16384) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`${fieldName}_required`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${fieldName}_too_large`);
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new Error(`${fieldName}_invalid`);
  }
  return normalized;
}

function normalizeEncryptedMessageInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("encrypted_payload_required");
  }

  const version = Number(input.v || input.version || 0);
  const algorithm = String(input.alg || input.algorithm || "").trim();
  const iv = normalizeBase64Input(input.iv, "iv", 2048);
  const ciphertext = normalizeBase64Input(input.ciphertext || input.ct, "ciphertext", 24000);

  if (version !== 1) {
    throw new Error("unsupported_encryption_version");
  }
  if (algorithm !== "AES-GCM") {
    throw new Error("unsupported_encryption_algorithm");
  }

  return {
    v: 1,
    alg: "AES-GCM",
    iv,
    ct: ciphertext
  };
}

function serializeEncryptedMessagePayload(payload) {
  return JSON.stringify({
    e2ee: 1,
    v: payload.v,
    alg: payload.alg,
    iv: payload.iv,
    ct: payload.ct
  });
}

function normalizePublicKeyJwkInput(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error("public_key_required");
  }
  if (normalized.length > 24000) {
    throw new Error("public_key_too_large");
  }

  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    throw new Error("invalid_public_key_json");
  }

  const kty = String(parsed?.kty || "");
  const n = String(parsed?.n || "");
  const e = String(parsed?.e || "");

  if (kty !== "RSA" || !n || !e) {
    throw new Error("invalid_public_key_jwk");
  }

  return normalized;
}

async function friendshipExists(userId1, userId2) {
  const pair = normalizeFriendPair(userId1, userId2);
  if (!pair) {
    return false;
  }

  const row = await get(
    `SELECT id FROM friendships WHERE user_id_a = $1 AND user_id_b = $2 LIMIT 1`,
    [pair.a, pair.b]
  );
  return Boolean(row);
}

async function getPendingFriendRequestRelation(viewerId, targetUserId) {
  const viewer = normalizeUserId(viewerId);
  const target = normalizeUserId(targetUserId);
  if (!viewer || !target || viewer === target) {
    return {
      hasIncomingRequest: false,
      hasOutgoingRequest: false
    };
  }

  const incoming = await get(
    `SELECT id FROM friend_requests WHERE sender_id = $1 AND receiver_id = $2 LIMIT 1`,
    [target, viewer]
  );
  const outgoing = await get(
    `SELECT id FROM friend_requests WHERE sender_id = $1 AND receiver_id = $2 LIMIT 1`,
    [viewer, target]
  );

  return {
    hasIncomingRequest: Boolean(incoming),
    hasOutgoingRequest: Boolean(outgoing)
  };
}

function imageRowToDataUrl(blob, mime) {
  if (!blob || !mime) {
    return "";
  }
  if (!Buffer.isBuffer(blob)) {
    return "";
  }
  return `data:${mime};base64,${blob.toString("base64")}`;
}

function sanitizeUser(row, options = {}) {
  const includeImages = options.includeImages !== false;
  if (!row) {
    return null;
  }

  const avatarFromBlob = imageRowToDataUrl(row.avatar_blob, row.avatar_mime);
  const bannerFromBlob = imageRowToDataUrl(row.banner_blob, row.banner_mime);

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    bio: row.bio || "",
    avatarUrl: includeImages ? (avatarFromBlob || row.avatar_url || "") : "",
    bannerUrl: includeImages ? (bannerFromBlob || row.banner_url || "") : "",
    spotifyLinked: Boolean(row.spotify_id),
    spotifyId: row.spotify_id || "",
    spotifyDisplayName: row.spotify_display_name || ""
  };
}

function decodeOptionalImageData(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return { blob: null, mime: "" };
  }

  const match = normalized.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) {
    throw new Error("invalid_image_data");
  }

  const mime = String(match[1] || "").toLowerCase();
  const allowedMime = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (!allowedMime.has(mime)) {
    throw new Error("invalid_image_type");
  }

  const base64Body = String(match[2] || "").replace(/\s+/g, "");
  const blob = Buffer.from(base64Body, "base64");
  if (!blob.length) {
    throw new Error("invalid_image_data");
  }
  if (blob.length > FIRESTORE_IMAGE_MAX_BYTES) {
    throw new Error("image_too_large");
  }

  return { blob, mime };
}

async function convertGifToMp4(gifBuffer) {
  return new Promise((resolve, reject) => {
    const tempGifPath = path.join(__dirname, `.tmp-${crypto.randomUUID()}.gif`);
    const tempMp4Path = path.join(__dirname, `.tmp-${crypto.randomUUID()}.mp4`);
    const tempMp4CompressedPath = path.join(__dirname, `.tmp-${crypto.randomUUID()}-compressed.mp4`);

    try {
      fs.writeFileSync(tempGifPath, gifBuffer);

      ffmpeg(tempGifPath)
        .outputOptions([
          "-c:v libx264",
          "-pix_fmt yuv420p",
          "-crf 28",
          "-preset fast",
          "-movflags +faststart"
        ])
        .output(tempMp4Path)
        .on("end", () => {
          try {
            let mp4Buffer = fs.readFileSync(tempMp4Path);
            
            // If MP4 is still too large, compress more aggressively
            if (mp4Buffer.length > FIRESTORE_IMAGE_MAX_BYTES) {
              console.warn(`MP4 size ${mp4Buffer.length} exceeds max, compressing further...`);
              
              // Re-encode with higher compression
              ffmpeg(tempMp4Path)
                .outputOptions([
                  "-c:v libx264",
                  "-pix_fmt yuv420p",
                  "-crf 35",
                  "-preset slower",
                  "-movflags +faststart",
                  "-b:v 300k"
                ])
                .output(tempMp4CompressedPath)
                .on("end", () => {
                  try {
                    const compressedBuffer = fs.readFileSync(tempMp4CompressedPath);
                    
                    // Cleanup temp files
                    [tempGifPath, tempMp4Path, tempMp4CompressedPath].forEach(f => {
                      if (fs.existsSync(f)) fs.unlinkSync(f);
                    });
                    
                    // Still too large, reject
                    if (compressedBuffer.length > FIRESTORE_IMAGE_MAX_BYTES) {
                      reject(new Error("video_too_large_after_compression"));
                    } else {
                      resolve({ blob: compressedBuffer, mime: "video/mp4", compressed: true });
                    }
                  } catch (err) {
                    reject(err);
                  }
                })
                .on("error", (err) => {
                  [tempGifPath, tempMp4Path, tempMp4CompressedPath].forEach(f => {
                    try {
                      if (fs.existsSync(f)) fs.unlinkSync(f);
                    } catch (e) {}
                  });
                  reject(err);
                })
                .run();
            } else {
              // Cleanup temp files
              fs.unlinkSync(tempGifPath);
              fs.unlinkSync(tempMp4Path);
              resolve({ blob: mp4Buffer, mime: "video/mp4", compressed: false });
            }
          } catch (err) {
            reject(err);
          }
        })
        .on("error", (err) => {
          try {
            if (fs.existsSync(tempGifPath)) fs.unlinkSync(tempGifPath);
            if (fs.existsSync(tempMp4Path)) fs.unlinkSync(tempMp4Path);
            if (fs.existsSync(tempMp4CompressedPath)) fs.unlinkSync(tempMp4CompressedPath);
          } catch (e) {
            // ignore cleanup errors
          }
          reject(err);
        })
        .run();
    } catch (err) {
      try {
        if (fs.existsSync(tempGifPath)) fs.unlinkSync(tempGifPath);
        if (fs.existsSync(tempMp4Path)) fs.unlinkSync(tempMp4Path);
        if (fs.existsSync(tempMp4CompressedPath)) fs.unlinkSync(tempMp4CompressedPath);
      } catch (e) {
        // ignore cleanup errors
      }
      reject(err);
    }
  });
}

async function enrichConcertMessagesWithAvatars(rows) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const userIds = Array.from(
    new Set(
      normalizedRows
        .map((row) => normalizeUserId(row?.user_id))
        .filter((id) => id > 0)
    )
  );

  if (!userIds.length) {
    return normalizedRows.map((row) => ({
      ...row,
      sender_avatar_url: ""
    }));
  }

  const placeholders = userIds.map(() => "?").join(", ");
  const userRows = await all(
    `SELECT id, avatar_blob, avatar_mime FROM users WHERE id IN (${placeholders})`,
    userIds
  );

  const avatarMap = new Map();
  for (const userRow of userRows) {
    avatarMap.set(
      Number(userRow.id),
      imageRowToDataUrl(userRow.avatar_blob, userRow.avatar_mime) || ""
    );
  }

  return normalizedRows.map((row) => ({
    ...row,
    sender_avatar_url: avatarMap.get(Number(row?.user_id || 0)) || ""
  }));
}

function parseAuthToken(req) {
  const raw = String(req.headers.authorization || "").trim();
  if (!raw.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return raw.slice(7).trim();
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  await run(
    `INSERT INTO sessions (user_id, token, created_at, expires_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, token, now, expiresAt]
  );

  return { token, expiresAt };
}

async function authMiddleware(req, res, next) {
  try {
    const token = parseAuthToken(req);
    if (!token) {
      res.status(401).json({ error: "auth_required" });
      return;
    }

    const sessionRow = await get(
      `
        SELECT s.user_id, s.expires_at, u.id, u.username, u.email, u.bio, u.spotify_id, u.spotify_display_name
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
      `,
      [token]
    );

    if (!sessionRow) {
      res.status(401).json({ error: "invalid_session" });
      return;
    }

    if (Date.now() >= Number(sessionRow.expires_at || 0)) {
      await run(`DELETE FROM sessions WHERE token = $1`, [token]);
      res.status(401).json({ error: "session_expired" });
      return;
    }

    req.authToken = token;
    req.user = sanitizeUser(sessionRow, { includeImages: false });
    next();
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function syncUsersToFirestore() {
  if (!hasFirestoreConfig()) {
    return false;
  }

  try {
    const userRows = await all(
      `
        SELECT
          COALESCE(CAST(id AS INTEGER), rowid) AS id,
          username,
          email,
          password_hash,
          bio,
          avatar_blob,
          avatar_mime,
          banner_blob,
          banner_mime,
          spotify_id,
          spotify_display_name,
          created_at,
          updated_at
        FROM users
      `
    );

    await mirrorSqliteTables([
      {
        collection: "users",
        idField: "id",
        rows: userRows
      }
    ]);

    return true;
  } catch (error) {
    console.error("Firestore users sync failed", error);
    return false;
  }
}

function decodeFirestoreBlobField(row, fieldName) {
  const rawValue = row?.[fieldName];
  if (!rawValue) {
    return null;
  }

  if (Buffer.isBuffer(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue !== "string") {
    return null;
  }

  const encoding = String(row?.[`${fieldName}_encoding`] || "").trim().toLowerCase();
  if (encoding && encoding !== "base64") {
    return null;
  }

  try {
    const normalized = rawValue.replace(/\s+/g, "");
    if (!normalized) {
      return null;
    }
    return Buffer.from(normalized, "base64");
  } catch (error) {
    return null;
  }
}

function normalizeFirestoreUserRow(row) {
  const id = Number(row?.id || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  const username = String(row?.username || "").trim();
  const email = String(row?.email || "").trim().toLowerCase();
  const passwordHash = String(row?.password_hash || "").trim();

  if (!username || !email || !passwordHash) {
    return null;
  }

  return {
    id,
    username,
    email,
    passwordHash,
    bio: String(row?.bio || "").trim(),
    avatarBlob: decodeFirestoreBlobField(row, "avatar_blob"),
    avatarMime: String(row?.avatar_mime || "").trim().toLowerCase(),
    bannerBlob: decodeFirestoreBlobField(row, "banner_blob"),
    bannerMime: String(row?.banner_mime || "").trim().toLowerCase(),
    spotifyId: String(row?.spotify_id || "").trim(),
    spotifyDisplayName: String(row?.spotify_display_name || "").trim(),
    createdAt: Number(row?.created_at || 0) || Date.now(),
    updatedAt: Number(row?.updated_at || 0) || Date.now()
  };
}

async function hydrateUsersFromFirestore() {
  if (!hasFirestoreConfig()) {
    return false;
  }

  try {
    const payload = await fetchFirestoreTables([
      { collection: "users", idField: "id" }
    ]);
    const rows = Array.isArray(payload?.users) ? payload.users : [];

    let importedCount = 0;
    for (const rawRow of rows) {
      const user = normalizeFirestoreUserRow(rawRow);
      if (!user) {
        continue;
      }

      const existingById = await get(`SELECT id FROM users WHERE id = ?`, [user.id]);
      if (existingById) {
        await run(
          `UPDATE users
           SET username = ?,
               email = ?,
               password_hash = ?,
               bio = ?,
               avatar_blob = ?,
               avatar_mime = ?,
               banner_blob = ?,
               banner_mime = ?,
               spotify_id = ?,
               spotify_display_name = ?,
               created_at = ?,
               updated_at = ?
           WHERE id = ?`,
          [
            user.username,
            user.email,
            user.passwordHash,
            user.bio,
            user.avatarBlob,
            user.avatarMime,
            user.bannerBlob,
            user.bannerMime,
            user.spotifyId,
            user.spotifyDisplayName,
            user.createdAt,
            user.updatedAt,
            user.id
          ]
        );
      } else {
        await run(
          `INSERT INTO users
            (id, username, email, password_hash, bio, avatar_blob, avatar_mime, banner_blob, banner_mime, spotify_id, spotify_display_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            user.id,
            user.username,
            user.email,
            user.passwordHash,
            user.bio,
            user.avatarBlob,
            user.avatarMime,
            user.bannerBlob,
            user.bannerMime,
            user.spotifyId,
            user.spotifyDisplayName,
            user.createdAt,
            user.updatedAt
          ]
        );
      }

      importedCount += 1;
    }

    if (importedCount > 0) {
      console.log(`Hydrated ${importedCount} user(s) from Firestore`);
    }
    return true;
  } catch (error) {
    console.error("Firestore users hydration failed", error);
    return false;
  }
}

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; "
      + "script-src 'self' 'unsafe-inline'; "
      + "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
      + "font-src 'self' https://fonts.gstatic.com data:; "
      + "img-src 'self' data: https:; "
      + "connect-src 'self' https://accounts.spotify.com https://api.spotify.com https://app.ticketmaster.com https://corsproxy.io https://api.codetabs.com; "
      + "object-src 'none'; "
      + "base-uri 'self'; "
      + "frame-ancestors 'none'; "
      + "upgrade-insecure-requests; "
      + "block-all-mixed-content"
  );
  next();
});

app.use((req, res, next) => {
  const origin = String(req.headers.origin || "").trim();
  const requestedPrivateNetwork = String(req.headers["access-control-request-private-network"] || "").toLowerCase() === "true";
  if (origin && ALLOWED_CORS_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
    if (requestedPrivateNetwork) {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (username.length < 3) {
      res.status(400).json({ error: "username_too_short" });
      return;
    }
    if (!isValidEmail(email)) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "password_too_short" });
      return;
    }

    const existing = await get(`SELECT id FROM users WHERE username = ? OR email = ?`, [username, email]);
    if (existing) {
      res.status(409).json({ error: "account_already_exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = Date.now();
    const nextUserId = await getNextUserId();
    await run(
      `INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [nextUserId, username, email, passwordHash, now, now]
    );

    const userId = nextUserId;
    const session = await createSession(userId);
    const userRow = await get(
      `SELECT id, username, email, bio, spotify_id, spotify_display_name FROM users WHERE id = ?`,
      [userId]
    );

    const synced = await syncUsersToFirestore();
    if (!synced) {
      console.warn("Firestore users sync skipped/failed after register");
    }

    res.status(201).json({ token: session.token, expiresAt: session.expiresAt, user: sanitizeUser(userRow, { includeImages: false }) });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!isValidEmail(email) || !password) {
      res.status(400).json({ error: "invalid_credentials" });
      return;
    }

    let userRow = await get(
      `SELECT id, username, email, bio, password_hash, spotify_id, spotify_display_name FROM users WHERE email = ?`,
      [email]
    );

    // In hosted mode with ephemeral disk, local SQLite may start empty.
    // If that happens, rehydrate users from Firestore then retry once.
    if (!userRow && hasFirestoreConfig()) {
      const hydrated = await hydrateUsersFromFirestore();
      if (hydrated) {
        userRow = await get(
          `SELECT id, username, email, bio, password_hash, spotify_id, spotify_display_name FROM users WHERE email = ?`,
          [email]
        );
      }
    }

    if (!userRow) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const passwordOk = await bcrypt.compare(password, String(userRow.password_hash || ""));
    if (!passwordOk) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const session = await createSession(userRow.id);
    res.status(200).json({ token: session.token, expiresAt: session.expiresAt, user: sanitizeUser(userRow, { includeImages: false }) });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  res.status(200).json({ user: req.user });
});

app.post("/api/auth/logout", authMiddleware, async (req, res) => {
  try {
    await run(`DELETE FROM sessions WHERE token = ?`, [req.authToken]);
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/spotify/link", authMiddleware, async (req, res) => {
  try {
    const spotifyId = String(req.body?.spotifyId || "").trim();
    const spotifyDisplayName = String(req.body?.spotifyDisplayName || "").trim();

    if (!spotifyId) {
      res.status(400).json({ error: "spotify_id_required" });
      return;
    }

    const now = Date.now();
    await run(
      `UPDATE users SET spotify_id = ?, spotify_display_name = ?, updated_at = ? WHERE id = ?`,
      [spotifyId, spotifyDisplayName, now, req.user.id]
    );

    const updatedUser = await get(
      `SELECT id, username, email, bio, spotify_id, spotify_display_name FROM users WHERE id = $1`,
      [req.user.id]
    );

    const synced = await syncUsersToFirestore();
    if (!synced) {
      console.warn("Firestore users sync skipped/failed after spotify link");
    }

    res.status(200).json({ user: sanitizeUser(updatedUser, { includeImages: false }) });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/profile", authMiddleware, async (req, res) => {
  try {
    const userRow = await get(
      `SELECT id, username, email, bio, avatar_url, banner_url, avatar_blob, avatar_mime, banner_blob, banner_mime, spotify_id, spotify_display_name FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (!userRow) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    res.status(200).json({ user: sanitizeUser(userRow) });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.put("/api/profile", authMiddleware, async (req, res) => {
  try {
    const currentUser = await get(
      `SELECT id, username, email, bio, avatar_url, banner_url, avatar_blob, avatar_mime, banner_blob, banner_mime, spotify_id, spotify_display_name FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (!currentUser) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const body = req.body || {};
    const hasUsername = Object.prototype.hasOwnProperty.call(body, "username");
    const hasEmail = Object.prototype.hasOwnProperty.call(body, "email");
    const hasBio = Object.prototype.hasOwnProperty.call(body, "bio");
    const hasAvatar = Object.prototype.hasOwnProperty.call(body, "avatarDataUrl");
    const hasBanner = Object.prototype.hasOwnProperty.call(body, "bannerDataUrl");

    const username = hasUsername ? String(body.username || "").trim() : currentUser.username;
    const email = hasEmail ? String(body.email || "").trim().toLowerCase() : currentUser.email;
    const bio = hasBio ? String(body.bio || "").trim() : (currentUser.bio || "");

    let avatarBlob = currentUser.avatar_blob || null;
    let avatarMime = currentUser.avatar_mime || "";
    let bannerBlob = currentUser.banner_blob || null;
    let bannerMime = currentUser.banner_mime || "";

    if (hasAvatar) {
      const avatarPayload = decodeOptionalImageData(body.avatarDataUrl);
      let blob = avatarPayload.blob;
      let mime = avatarPayload.mime;
      
      // Convert GIF to MP4 for avatars too (optional, but we can)
      if (mime === "image/gif" && blob.length > 100 * 1024) {
        try {
          const converted = await convertGifToMp4(blob);
          blob = converted.blob;
          mime = converted.mime;
        } catch (err) {
          console.warn("GIF to MP4 conversion failed for avatar, keeping as GIF:", err.message);
        }
      }
      
      avatarBlob = blob;
      avatarMime = mime;
    }
    if (hasBanner) {
      const bannerPayload = decodeOptionalImageData(body.bannerDataUrl);
      let blob = bannerPayload.blob;
      let mime = bannerPayload.mime;
      
      // Convert GIF to MP4 for banners
      if (mime === "image/gif") {
        try {
          const converted = await convertGifToMp4(blob);
          blob = converted.blob;
          mime = converted.mime;
        } catch (err) {
          console.warn("GIF to MP4 conversion failed for banner, keeping as GIF:", err.message);
        }
      }
      
      bannerBlob = blob;
      bannerMime = mime;
    }

    if (!username || username.length < 3) {
      res.status(400).json({ error: "username_too_short" });
      return;
    }
    if (!isValidEmail(email)) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }
    if (bio.length > 400) {
      res.status(400).json({ error: "bio_too_long" });
      return;
    }

    const duplicate = await get(
      `SELECT id FROM users WHERE (username = $1 OR email = $2) AND id != $3`,
      [username, email, req.user.id]
    );
    if (duplicate) {
      res.status(409).json({ error: "account_already_exists" });
      return;
    }

    const now = Date.now();
    await run(
      `UPDATE users SET username = $1, email = $2, bio = $3, avatar_blob = $4, avatar_mime = $5, banner_blob = $6, banner_mime = $7, updated_at = $8 WHERE id = $9`,
      [username, email, bio, avatarBlob, avatarMime, bannerBlob, bannerMime, now, req.user.id]
    );

    const updatedUser = await get(
      `SELECT id, username, email, bio, avatar_url, banner_url, avatar_blob, avatar_mime, banner_blob, banner_mime, spotify_id, spotify_display_name FROM users WHERE id = $1`,
      [req.user.id]
    );

    const synced = await syncUsersToFirestore();
    if (!synced) {
      console.warn("Firestore users sync skipped/failed after profile update");
    }

    res.status(200).json({ user: sanitizeUser(updatedUser) });
  } catch (error) {
    const message = String(error?.message || "");
    if (message === "invalid_image_data") {
      res.status(400).json({ error: "invalid_image_data" });
      return;
    }
    if (message === "invalid_image_type") {
      res.status(400).json({ error: "invalid_image_type" });
      return;
    }
    if (message === "image_too_large") {
      res.status(400).json({ error: "image_too_large" });
      return;
    }
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/users/search", authMiddleware, async (req, res) => {
  try {
    const q = String(req.query?.q || "").trim();
    const offsetRaw = Number(req.query?.offset || 0);
    const limitRaw = Number(req.query?.limit || 10);
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.min(25, Math.max(1, Math.floor(limitRaw))) : 10;

    if (!q) {
      res.status(200).json({ items: [], total: 0, offset, limit });
      return;
    }

    const pattern = `%${q.toLowerCase()}%`;
    const totalRow = await get(
      `
        SELECT COUNT(*) AS total
        FROM users
        WHERE id != ?
          AND (
            lower(username) LIKE ?
            OR lower(email) LIKE ?
            OR lower(COALESCE(bio, '')) LIKE ?
          )
      `,
      [req.user.id, pattern, pattern, pattern]
    );

    const rows = await all(
      `
        SELECT id, username, email, bio, avatar_blob, avatar_mime
        FROM users
        WHERE id != ?
          AND (
            lower(username) LIKE ?
            OR lower(email) LIKE ?
            OR lower(COALESCE(bio, '')) LIKE ?
          )
        ORDER BY username COLLATE NOCASE ASC
        LIMIT ? OFFSET ?
      `,
      [req.user.id, pattern, pattern, pattern, limit, offset]
    );

    const items = rows.map((row) => ({
      id: row.id,
      username: row.username || "",
      email: row.email || "",
      bio: row.bio || "",
      avatarUrl: imageRowToDataUrl(row.avatar_blob, row.avatar_mime) || ""
    }));

    res.status(200).json({
      items,
      total: Number(totalRow?.total || 0),
      offset,
      limit
    });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/users/:id", authMiddleware, async (req, res) => {
  try {
    const userId = Number(req.params.id || 0);
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }

    let row = await get(
      `
        SELECT id, username, email, bio, spotify_id, spotify_display_name,
               avatar_blob, avatar_mime, banner_blob, banner_mime
        FROM users
        WHERE id = ?
      `,
      [userId]
    );

    if (!row && hasFirestoreConfig()) {
      const hydrated = await hydrateUsersFromFirestore();
      if (hydrated) {
        row = await get(
          `
            SELECT id, username, email, bio, spotify_id, spotify_display_name,
                   avatar_blob, avatar_mime, banner_blob, banner_mime
            FROM users
            WHERE id = ?
          `,
          [userId]
        );
      }
    }

    if (!row) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const avatarUrl = imageRowToDataUrl(row.avatar_blob, row.avatar_mime) || "";
    const bannerUrl = imageRowToDataUrl(row.banner_blob, row.banner_mime) || "";
    const isSelf = req.user.id === userId;
    const isFriend = isSelf ? false : await friendshipExists(req.user.id, userId);
    const requestState = isSelf || isFriend
      ? { hasIncomingRequest: false, hasOutgoingRequest: false }
      : await getPendingFriendRequestRelation(req.user.id, userId);

    res.status(200).json({
      user: {
        id: row.id,
        username: row.username || "",
        email: row.email || "",
        bio: row.bio || "",
        avatarUrl,
        bannerUrl,
        spotifyLinked: Boolean(row.spotify_id),
        spotifyDisplayName: row.spotify_display_name || "",
        friendship: {
          isSelf,
          isFriend,
          hasIncomingRequest: Boolean(requestState.hasIncomingRequest),
          hasOutgoingRequest: Boolean(requestState.hasOutgoingRequest)
        }
      }
    });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/friends", authMiddleware, async (req, res) => {
  try {
    const rows = await all(
      `
        SELECT
          u.id,
          u.username,
          u.email,
          u.bio,
          u.avatar_blob,
          u.avatar_mime,
          f.created_at
        FROM friendships f
        JOIN users u
          ON u.id = CASE WHEN f.user_id_a = ? THEN f.user_id_b ELSE f.user_id_a END
        WHERE f.user_id_a = ? OR f.user_id_b = ?
        ORDER BY lower(u.username) ASC
      `,
      [req.user.id, req.user.id, req.user.id]
    );

    const items = rows.map((row) => ({
      id: row.id,
      username: row.username || "",
      email: row.email || "",
      bio: row.bio || "",
      avatarUrl: imageRowToDataUrl(row.avatar_blob, row.avatar_mime) || "",
      connectedAt: Number(row.created_at || 0)
    }));

    res.status(200).json({ items });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/friends/:id", authMiddleware, async (req, res) => {
  try {
    const targetUserId = normalizeUserId(req.params.id);
    if (!targetUserId) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }
    if (targetUserId === req.user.id) {
      res.status(400).json({ error: "cannot_friend_self" });
      return;
    }

    const targetUser = await get(`SELECT id FROM users WHERE id = $1`, [targetUserId]);
    if (!targetUser) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const pair = normalizeFriendPair(req.user.id, targetUserId);
    if (!pair) {
      res.status(400).json({ error: "invalid_friend_pair" });
      return;
    }

    const alreadyFriend = await friendshipExists(req.user.id, targetUserId);
    if (alreadyFriend) {
      res.status(200).json({ ok: true, alreadyFriend: true });
      return;
    }

    const existingOutgoing = await get(
      `SELECT id FROM friend_requests WHERE sender_id = $1 AND receiver_id = $2 LIMIT 1`,
      [req.user.id, targetUserId]
    );
    if (existingOutgoing) {
      res.status(200).json({ ok: true, requestPending: true });
      return;
    }

    const existingIncoming = await get(
      `SELECT id FROM friend_requests WHERE sender_id = $1 AND receiver_id = $2 LIMIT 1`,
      [targetUserId, req.user.id]
    );
    if (existingIncoming) {
      res.status(409).json({ error: "incoming_request_exists" });
      return;
    }

    const insertResult = await run(
      `INSERT INTO friend_requests (sender_id, receiver_id, created_at) VALUES (?, ?, ?)`,
      [req.user.id, targetUserId, Date.now()]
    );

    res.status(200).json({
      ok: true,
      requestSent: Boolean(insertResult.changes),
      alreadyFriend: false
    });
  } catch (error) {
    if (String(error?.message || "").toLowerCase().includes("unique")) {
      res.status(200).json({ ok: true, requestPending: true, alreadyFriend: false });
      return;
    }
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/friend-requests", authMiddleware, async (req, res) => {
  try {
    const incomingRows = await all(
      `
        SELECT
          fr.sender_id,
          fr.created_at,
          u.username,
          u.email,
          u.avatar_blob,
          u.avatar_mime
        FROM friend_requests fr
        JOIN users u ON u.id = fr.sender_id
        WHERE fr.receiver_id = ?
        ORDER BY fr.created_at DESC
      `,
      [req.user.id]
    );

    const outgoingRows = await all(
      `
        SELECT
          fr.receiver_id,
          fr.created_at,
          u.username,
          u.email,
          u.avatar_blob,
          u.avatar_mime
        FROM friend_requests fr
        JOIN users u ON u.id = fr.receiver_id
        WHERE fr.sender_id = ?
        ORDER BY fr.created_at DESC
      `,
      [req.user.id]
    );

    const incoming = incomingRows.map((row) => ({
      userId: Number(row.sender_id || 0),
      username: row.username || "Utilisateur",
      email: row.email || "",
      avatarUrl: imageRowToDataUrl(row.avatar_blob, row.avatar_mime) || "",
      createdAt: Number(row.created_at || 0)
    }));

    const outgoing = outgoingRows.map((row) => ({
      userId: Number(row.receiver_id || 0),
      username: row.username || "Utilisateur",
      email: row.email || "",
      avatarUrl: imageRowToDataUrl(row.avatar_blob, row.avatar_mime) || "",
      createdAt: Number(row.created_at || 0)
    }));

    res.status(200).json({
      incoming,
      outgoing
    });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/friend-requests/:userId/accept", authMiddleware, async (req, res) => {
  try {
    const senderId = normalizeUserId(req.params.userId);
    if (!senderId || senderId === req.user.id) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }

    const sender = await get(`SELECT id FROM users WHERE id = $1`, [senderId]);
    if (!sender) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const pending = await get(
      `SELECT id FROM friend_requests WHERE sender_id = $1 AND receiver_id = $2 LIMIT 1`,
      [senderId, req.user.id]
    );
    if (!pending) {
      res.status(404).json({ error: "request_not_found" });
      return;
    }

    const pair = normalizeFriendPair(req.user.id, senderId);
    if (!pair) {
      res.status(400).json({ error: "invalid_friend_pair" });
      return;
    }

    await run(
      `INSERT OR IGNORE INTO friendships (user_id_a, user_id_b, created_at) VALUES ($1, $2, $3)`,
      [pair.a, pair.b, Date.now()]
    );

    await run(
      `DELETE FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $3 AND receiver_id = $4)`,
      [senderId, req.user.id, req.user.id, senderId]
    );

    res.status(200).json({ ok: true, accepted: true });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.delete("/api/friend-requests/:userId", authMiddleware, async (req, res) => {
  try {
    const targetUserId = normalizeUserId(req.params.userId);
    if (!targetUserId || targetUserId === req.user.id) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }

    const incomingResult = await run(
      `DELETE FROM friend_requests WHERE sender_id = $1 AND receiver_id = $2`,
      [targetUserId, req.user.id]
    );
    if (Number(incomingResult.rowCount || 0) > 0) {
      res.status(200).json({ ok: true, action: "refused" });
      return;
    }

    const outgoingResult = await run(
      `DELETE FROM friend_requests WHERE sender_id = $1 AND receiver_id = $2`,
      [req.user.id, targetUserId]
    );
    if (Number(outgoingResult.rowCount || 0) > 0) {
      res.status(200).json({ ok: true, action: "cancelled" });
      return;
    }

    res.status(404).json({ error: "request_not_found" });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/notifications", authMiddleware, async (req, res) => {
  try {
    const rows = await all(
      `
        SELECT
          fr.sender_id,
          fr.created_at,
          u.username,
          u.avatar_blob,
          u.avatar_mime
        FROM friend_requests fr
        JOIN users u ON u.id = fr.sender_id
        WHERE fr.receiver_id = ?
        ORDER BY fr.created_at DESC
        LIMIT 25
      `,
      [req.user.id]
    );

    const items = rows.map((row) => ({
      type: "friend_request",
      userId: Number(row.sender_id || 0),
      username: row.username || "Utilisateur",
      avatarUrl: imageRowToDataUrl(row.avatar_blob, row.avatar_mime) || "",
      createdAt: Number(row.created_at || 0)
    }));

    res.status(200).json({
      unreadCount: items.length,
      items
    });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.delete("/api/friends/:id", authMiddleware, async (req, res) => {
  try {
    const targetUserId = normalizeUserId(req.params.id);
    if (!targetUserId) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }
    if (targetUserId === req.user.id) {
      res.status(400).json({ error: "cannot_unfriend_self" });
      return;
    }

    const pair = normalizeFriendPair(req.user.id, targetUserId);
    if (!pair) {
      res.status(400).json({ error: "invalid_friend_pair" });
      return;
    }

    const result = await run(
      `DELETE FROM friendships WHERE user_id_a = $1 AND user_id_b = $2`,
      [pair.a, pair.b]
    );

    res.status(200).json({
      ok: true,
      removed: Number(result.rowCount || 0) > 0
    });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.put("/api/e2ee/public-key", authMiddleware, async (req, res) => {
  try {
    const publicKeyJwk = normalizePublicKeyJwkInput(req.body?.publicKeyJwk);
    const now = Date.now();

    await run(
      `
        INSERT INTO e2ee_user_keys (user_id, public_key_jwk, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          public_key_jwk = excluded.public_key_jwk,
          updated_at = excluded.updated_at
      `,
      [req.user.id, publicKeyJwk, now, now]
    );

    res.status(200).json({ ok: true });
  } catch (error) {
    const code = String(error?.message || "");
    if (
      code === "public_key_required"
      || code === "public_key_too_large"
      || code === "invalid_public_key_json"
      || code === "invalid_public_key_jwk"
    ) {
      res.status(400).json({ error: code });
      return;
    }

    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/e2ee/public-key/:userId", authMiddleware, async (req, res) => {
  try {
    const targetUserId = normalizeUserId(req.params.userId);
    if (!targetUserId) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }

    if (targetUserId !== req.user.id) {
      const isFriend = await friendshipExists(req.user.id, targetUserId);
      if (!isFriend) {
        res.status(403).json({ error: "not_friends" });
        return;
      }
    }

    const keyRow = await get(
      `SELECT public_key_jwk, updated_at FROM e2ee_user_keys WHERE user_id = ? LIMIT 1`,
      [targetUserId]
    );

    if (!keyRow) {
      res.status(404).json({ error: "public_key_not_found" });
      return;
    }

    res.status(200).json({
      userId: targetUserId,
      publicKeyJwk: String(keyRow.public_key_jwk || ""),
      updatedAt: Number(keyRow.updated_at || 0)
    });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/private-chat/:userId/e2ee-key", authMiddleware, async (req, res) => {
  try {
    const targetUserId = normalizeUserId(req.params.userId);
    if (!targetUserId) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }
    if (targetUserId === req.user.id) {
      res.status(400).json({ error: "invalid_chat_target" });
      return;
    }

    const isFriend = await friendshipExists(req.user.id, targetUserId);
    if (!isFriend) {
      res.status(403).json({ error: "not_friends" });
      return;
    }

    const pair = normalizeFriendPair(req.user.id, targetUserId);
    if (!pair) {
      res.status(400).json({ error: "invalid_friend_pair" });
      return;
    }

    const row = await get(
      `
        SELECT key_for_a, key_for_b, algorithm, version, updated_at
        FROM e2ee_private_chat_keys
        WHERE user_id_a = ? AND user_id_b = ?
        LIMIT 1
      `,
      [pair.a, pair.b]
    );

    if (!row) {
      res.status(200).json({ exists: false });
      return;
    }

    const wrappedKey = req.user.id === pair.a
      ? String(row.key_for_a || "")
      : String(row.key_for_b || "");

    if (!wrappedKey) {
      res.status(200).json({ exists: false });
      return;
    }

    res.status(200).json({
      exists: true,
      wrappedKey,
      algorithm: String(row.algorithm || "AES-GCM"),
      version: Number(row.version || 1),
      updatedAt: Number(row.updated_at || 0)
    });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.put("/api/private-chat/:userId/e2ee-key", authMiddleware, async (req, res) => {
  try {
    const targetUserId = normalizeUserId(req.params.userId);
    if (!targetUserId) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }
    if (targetUserId === req.user.id) {
      res.status(400).json({ error: "invalid_chat_target" });
      return;
    }

    const isFriend = await friendshipExists(req.user.id, targetUserId);
    if (!isFriend) {
      res.status(403).json({ error: "not_friends" });
      return;
    }

    const pair = normalizeFriendPair(req.user.id, targetUserId);
    if (!pair) {
      res.status(400).json({ error: "invalid_friend_pair" });
      return;
    }

    const wrappedKeyForSelf = normalizeBase64Input(req.body?.wrappedKeyForSelf, "wrapped_key_for_self", 24000);
    const wrappedKeyForPeer = normalizeBase64Input(req.body?.wrappedKeyForPeer, "wrapped_key_for_peer", 24000);

    const requesterIsA = req.user.id === pair.a;
    const keyForA = requesterIsA ? wrappedKeyForSelf : wrappedKeyForPeer;
    const keyForB = requesterIsA ? wrappedKeyForPeer : wrappedKeyForSelf;
    const now = Date.now();

    await run(
      `
        INSERT INTO e2ee_private_chat_keys (
          user_id_a,
          user_id_b,
          key_for_a,
          key_for_b,
          algorithm,
          version,
          updated_by,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, 'AES-GCM', 1, ?, ?, ?)
        ON CONFLICT(user_id_a, user_id_b) DO UPDATE SET
          key_for_a = excluded.key_for_a,
          key_for_b = excluded.key_for_b,
          algorithm = excluded.algorithm,
          version = excluded.version,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `,
      [pair.a, pair.b, keyForA, keyForB, req.user.id, now, now]
    );

    res.status(200).json({ ok: true, version: 1, algorithm: "AES-GCM" });
  } catch (error) {
    const code = String(error?.message || "");
    if (
      code === "wrapped_key_for_self_required"
      || code === "wrapped_key_for_self_too_large"
      || code === "wrapped_key_for_self_invalid"
      || code === "wrapped_key_for_peer_required"
      || code === "wrapped_key_for_peer_too_large"
      || code === "wrapped_key_for_peer_invalid"
    ) {
      res.status(400).json({ error: code });
      return;
    }

    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/private-chat/:userId/messages", authMiddleware, async (req, res) => {
  try {
    const targetUserId = normalizeUserId(req.params.userId);
    if (!targetUserId) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }
    if (targetUserId === req.user.id) {
      res.status(400).json({ error: "invalid_chat_target" });
      return;
    }

    const targetUser = await get(`SELECT id FROM users WHERE id = $1`, [targetUserId]);
    if (!targetUser) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const isFriend = await friendshipExists(req.user.id, targetUserId);
    if (!isFriend) {
      res.status(403).json({ error: "not_friends" });
      return;
    }

    const pair = normalizeFriendPair(req.user.id, targetUserId);
    if (!pair) {
      res.status(400).json({ error: "invalid_friend_pair" });
      return;
    }

    const limitRaw = Number(req.query?.limit || 80);
    const limit = Number.isFinite(limitRaw) ? Math.min(120, Math.max(1, Math.floor(limitRaw))) : 80;

    const rows = await all(
      `
        SELECT
          id,
          sender_id,
          message,
          created_at
        FROM private_messages
        WHERE user_id_a = ? AND user_id_b = ?
        ORDER BY created_at ASC
        LIMIT ?
      `,
      [pair.a, pair.b, limit]
    );

    const senderIds = Array.from(
      new Set(
        rows
          .map((row) => normalizeUserId(row?.sender_id))
          .filter((id) => id > 0)
      )
    );

    let senderMap = new Map();
    if (senderIds.length) {
      const placeholders = senderIds.map(() => "?").join(", ");
      const senderRows = await all(
        `SELECT id, username, avatar_blob, avatar_mime FROM users WHERE id IN (${placeholders})`,
        senderIds
      );
      senderMap = new Map(
        senderRows.map((row) => ([
          Number(row.id),
          {
            username: row.username || "Utilisateur",
            avatarUrl: imageRowToDataUrl(row.avatar_blob, row.avatar_mime) || ""
          }
        ]))
      );
    }

    res.status(200).json({
      items: rows.map((row) => {
        const encryptedPayload = parseStoredEncryptedMessage(row.message);
        const senderInfo = senderMap.get(Number(row.sender_id || 0)) || { username: "Utilisateur", avatarUrl: "" };
        return {
          id: row.id,
          senderId: row.sender_id,
          senderUsername: senderInfo.username,
          senderAvatarUrl: senderInfo.avatarUrl,
          message: encryptedPayload ? "" : (row.message || ""),
          encrypted: encryptedPayload
            ? {
                v: encryptedPayload.version,
                alg: encryptedPayload.algorithm,
                iv: encryptedPayload.iv,
                ciphertext: encryptedPayload.ciphertext
              }
            : null,
          createdAt: Number(row.created_at || 0)
        };
      })
    });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/private-chat/:userId/messages", authMiddleware, async (req, res) => {
  try {
    const targetUserId = normalizeUserId(req.params.userId);
    if (!targetUserId) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }
    if (targetUserId === req.user.id) {
      res.status(400).json({ error: "invalid_chat_target" });
      return;
    }

    const targetUser = await get(`SELECT id FROM users WHERE id = $1`, [targetUserId]);
    if (!targetUser) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const isFriend = await friendshipExists(req.user.id, targetUserId);
    if (!isFriend) {
      res.status(403).json({ error: "not_friends" });
      return;
    }

    const pair = normalizeFriendPair(req.user.id, targetUserId);
    if (!pair) {
      res.status(400).json({ error: "invalid_friend_pair" });
      return;
    }

    let storedMessagePayload = "";
    let responseMessage = "";
    let responseEncrypted = null;

    if (req.body?.encrypted) {
      const encryptedInput = normalizeEncryptedMessageInput(req.body.encrypted);
      storedMessagePayload = serializeEncryptedMessagePayload(encryptedInput);
      responseEncrypted = {
        v: encryptedInput.v,
        alg: encryptedInput.alg,
        iv: encryptedInput.iv,
        ciphertext: encryptedInput.ct
      };
    } else {
      const legacyMessage = String(req.body?.message || "").trim();
      if (!legacyMessage) {
        res.status(400).json({ error: "encrypted_payload_required" });
        return;
      }
      if (legacyMessage.length > 500) {
        res.status(400).json({ error: "message_too_long" });
        return;
      }
      storedMessagePayload = legacyMessage;
      responseMessage = legacyMessage;
    }

    if (storedMessagePayload.length > 24000) {
      res.status(400).json({ error: "message_too_large" });
      return;
    }

    const now = Date.now();
    const insertResult = await run(
      `INSERT INTO private_messages (user_id_a, user_id_b, sender_id, message, created_at) VALUES (?, ?, ?, ?, ?)`,
      [pair.a, pair.b, req.user.id, storedMessagePayload, now]
    );

    res.status(201).json({
      item: {
        id: Number(insertResult.lastID || 0),
        senderId: req.user.id,
        senderUsername: req.user.username || "Utilisateur",
        message: responseMessage,
        encrypted: responseEncrypted,
        createdAt: now
      }
    });
  } catch (error) {
    const code = String(error?.message || "");
    if (
      code === "encrypted_payload_required"
      || code === "iv_required"
      || code === "iv_too_large"
      || code === "iv_invalid"
      || code === "ciphertext_required"
      || code === "ciphertext_too_large"
      || code === "ciphertext_invalid"
      || code === "unsupported_encryption_version"
      || code === "unsupported_encryption_algorithm"
    ) {
      res.status(400).json({ error: code });
      return;
    }

    res.status(500).json({ error: "server_error" });
  }
});

app.delete("/api/private-chat/:userId/messages/:messageId", authMiddleware, async (req, res) => {
  try {
    const targetUserId = normalizeUserId(req.params.userId);
    if (!targetUserId) {
      res.status(400).json({ error: "invalid_user_id" });
      return;
    }
    if (targetUserId === req.user.id) {
      res.status(400).json({ error: "invalid_chat_target" });
      return;
    }

    const messageId = normalizeUserId(req.params.messageId);
    if (!messageId) {
      res.status(400).json({ error: "invalid_message_id" });
      return;
    }

    const targetUser = await get(`SELECT id FROM users WHERE id = $1`, [targetUserId]);
    if (!targetUser) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const pair = normalizeFriendPair(req.user.id, targetUserId);
    if (!pair) {
      res.status(400).json({ error: "invalid_friend_pair" });
      return;
    }

    const messageRow = await get(
      `
        SELECT id, sender_id, user_id_a, user_id_b
        FROM private_messages
        WHERE id = ?
        LIMIT 1
      `,
      [messageId]
    );

    if (!messageRow) {
      res.status(404).json({ error: "message_not_found" });
      return;
    }

    if (Number(messageRow.user_id_a || 0) !== pair.a || Number(messageRow.user_id_b || 0) !== pair.b) {
      res.status(403).json({ error: "invalid_message_scope" });
      return;
    }

    if (Number(messageRow.sender_id || 0) !== req.user.id) {
      res.status(403).json({ error: "cannot_delete_other_message" });
      return;
    }

    const result = await run(`DELETE FROM private_messages WHERE id = ?`, [messageId]);
    if (Number(result.changes || 0) <= 0) {
      res.status(404).json({ error: "message_not_found" });
      return;
    }

    res.status(200).json({ ok: true, removed: true, messageId });
  } catch (error) {
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/concert-chat/:concertKey/messages", authMiddleware, async (req, res) => {
  try {
    const concertKey = normalizeConcertKey(req.params.concertKey);
    const limitRaw = Number(req.query?.limit || 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 50;

    await ensureDefaultConcertDiscussion(concertKey);

    const rows = await chatAll(
      `
        SELECT id, concert_key, user_id, username, message, created_at
        FROM concert_messages
        WHERE concert_key = ?
        ORDER BY created_at ASC
        LIMIT ?
      `,
      [concertKey, limit]
    );

    const rowsWithAvatars = await enrichConcertMessagesWithAvatars(rows);

    res.status(200).json({
      items: rowsWithAvatars.map((row) => ({
        id: row.id,
        concertKey: row.concert_key,
        userId: row.user_id,
        username: row.username,
        senderAvatarUrl: row.sender_avatar_url || "",
        message: row.message,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    if (String(error?.message || "") === "invalid_concert_key") {
      res.status(400).json({ error: "invalid_concert_key" });
      return;
    }
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/concert-chat/:concertKey/messages", authMiddleware, async (req, res) => {
  try {
    const concertKey = normalizeConcertKey(req.params.concertKey);
    const message = String(req.body?.message || "").trim();

    if (!message) {
      res.status(400).json({ error: "message_required" });
      return;
    }
    if (message.length > 500) {
      res.status(400).json({ error: "message_too_long" });
      return;
    }

    await ensureDefaultConcertDiscussion(concertKey);

    const now = Date.now();
    const insertResult = await chatRun(
      `INSERT INTO concert_messages (concert_key, user_id, username, message, created_at) VALUES (?, ?, ?, ?, ?)`,
      [concertKey, req.user.id, req.user.username || "Utilisateur", message, now]
    );

    res.status(201).json({
      item: {
        id: Number(insertResult.lastID || 0),
        concertKey,
        userId: req.user.id,
        username: req.user.username || "Utilisateur",
        message,
        createdAt: now
      }
    });
  } catch (error) {
    if (String(error?.message || "") === "invalid_concert_key") {
      res.status(400).json({ error: "invalid_concert_key" });
      return;
    }
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/concert-chat/messages", authMiddleware, async (req, res) => {
  try {
    const concertKey = normalizeConcertKey(req.query?.concertKey || "");
    const limitRaw = Number(req.query?.limit || 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 50;

    await ensureDefaultConcertDiscussion(concertKey);

    const rows = await chatAll(
      `
        SELECT id, concert_key, user_id, username, message, created_at
        FROM concert_messages
        WHERE concert_key = ?
        ORDER BY created_at ASC
        LIMIT ?
      `,
      [concertKey, limit]
    );

    const rowsWithAvatars = await enrichConcertMessagesWithAvatars(rows);

    res.status(200).json({
      items: rowsWithAvatars.map((row) => ({
        id: row.id,
        concertKey: row.concert_key,
        userId: row.user_id,
        username: row.username,
        senderAvatarUrl: row.sender_avatar_url || "",
        message: row.message,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    if (String(error?.message || "") === "invalid_concert_key") {
      res.status(400).json({ error: "invalid_concert_key" });
      return;
    }
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/concert-chat/messages", authMiddleware, async (req, res) => {
  try {
    const concertKey = normalizeConcertKey(req.body?.concertKey || "");
    const message = String(req.body?.message || "").trim();

    if (!message) {
      res.status(400).json({ error: "message_required" });
      return;
    }
    if (message.length > 500) {
      res.status(400).json({ error: "message_too_long" });
      return;
    }

    await ensureDefaultConcertDiscussion(concertKey);

    const now = Date.now();
    const insertResult = await chatRun(
      `INSERT INTO concert_messages (concert_key, user_id, username, message, created_at) VALUES (?, ?, ?, ?, ?)`,
      [concertKey, req.user.id, req.user.username || "Utilisateur", message, now]
    );

    res.status(201).json({
      item: {
        id: Number(insertResult.lastID || 0),
        concertKey,
        userId: req.user.id,
        username: req.user.username || "Utilisateur",
        message,
        createdAt: now
      }
    });
  } catch (error) {
    if (String(error?.message || "") === "invalid_concert_key") {
      res.status(400).json({ error: "invalid_concert_key" });
      return;
    }
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/health/firestore", async (req, res) => {
  try {
    if (!hasFirestoreConfig()) {
      const configError = getFirestoreConfigError();
      res.status(503).json({
        ok: false,
        error: "firestore_not_configured",
        details: configError || "missing_credentials_or_project_id"
      });
      return;
    }

    await pingFirestore();
    res.status(200).json({ ok: true });
  } catch (error) {
    const runtimeError = getFirestoreRuntimeError();
    const configError = getFirestoreConfigError();
    res.status(503).json({
      ok: false,
      error: "firestore_unreachable",
      details: String(runtimeError || configError || error?.message || "unknown_firestore_error")
    });
  }
});

app.use((req, res, next) => {
  const blockedPathPatterns = [
    /^\/\.env(?:\.|$)/i,
    /^\/certs(?:\/|$)/i,
    /^\/database(?:\/|$)/i,
    /^\/server\.js$/i,
    /^\/package(?:-lock)?\.json$/i,
    /^\/.*service-account.*\.json$/i,
  ];

  if (blockedPathPatterns.some((pattern) => pattern.test(req.path || ""))) {
    res.status(404).end();
    return;
  }

  next();
});

app.use(express.static(__dirname));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function createHttpsOptions() {
  if (!fs.existsSync(TLS_KEY_PATH) || !fs.existsSync(TLS_CERT_PATH)) {
    throw new Error(
      `TLS certificate missing. Expected files:\n- ${TLS_KEY_PATH}\n- ${TLS_CERT_PATH}\nRun: npm run dev:cert`
    );
  }

  return {
    key: fs.readFileSync(TLS_KEY_PATH),
    cert: fs.readFileSync(TLS_CERT_PATH)
  };
}

function startHttpRedirectServer() {
  const redirectServer = http.createServer((req, res) => {
    const location = `https://${CANONICAL_HOST}:${HTTPS_PORT}${req.url || "/"}`;
    res.writeHead(301, { Location: location });
    res.end();
  });

  redirectServer.listen(HTTP_PORT, () => {
    console.log(`HTTP redirect server listening on http://localhost:${HTTP_PORT} -> https://${CANONICAL_HOST}:${HTTPS_PORT}`);
  });
}

function startHostedHttpServer() {
  const hostedPort = Number(process.env.PORT || process.env.HTTP_PORT || 3000);
  const hostedHost = process.env.HOST || "0.0.0.0";

  app.listen(hostedPort, hostedHost, () => {
    console.log(`WithMe hosted HTTP server listening on http://${hostedHost}:${hostedPort}`);
  });
}

Promise.all([initDb(), initConcertChatDb(), initPrivateMessageDb()])
  .then(async () => {
    await hydrateUsersFromFirestore();

    const forceHostedMode = String(process.env.WITHME_DEPLOY_MODE || "").trim().toLowerCase() === "hosted";

    if (forceHostedMode) {
      startHostedHttpServer();
      return;
    }

    try {
      const httpsOptions = createHttpsOptions();
      https.createServer(httpsOptions, app).listen(HTTPS_PORT, () => {
        console.log(`WithMe HTTPS server listening on https://localhost:${HTTPS_PORT}`);
      });
      startHttpRedirectServer();
    } catch (error) {
      console.warn("TLS cert not available, starting hosted HTTP mode.");
      startHostedHttpServer();
    }
  })
  .catch((error) => {
    console.error("Failed to initialize database", error);
    process.exit(1);
  });
