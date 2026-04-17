const fs = require("fs");
const admin = require("firebase-admin");

let initialized = false;
let firestoreInstance = null;
let lastConfigError = null;
let lastRuntimeError = null;

function setConfigError(error) {
  if (!error) {
    lastConfigError = null;
    return;
  }

  const message = String(error.message || error || "firestore_config_error");
  lastConfigError = message;
}

function setRuntimeError(error) {
  if (!error) {
    lastRuntimeError = null;
    return;
  }

  const message = String(error.message || error || "firestore_runtime_error");
  lastRuntimeError = message;
}

function normalizeServiceAccountCredentials(credentials) {
  if (!credentials || typeof credentials !== "object") {
    return credentials;
  }

  const normalized = { ...credentials };
  if (typeof normalized.private_key === "string") {
    normalized.private_key = normalized.private_key.replace(/\\n/g, "\n").trim();
  }
  if (typeof normalized.client_email === "string") {
    normalized.client_email = normalized.client_email.trim();
  }
  if (typeof normalized.project_id === "string") {
    normalized.project_id = normalized.project_id.trim();
  }
  return normalized;
}

function getCredentialsFromEnv() {
  try {
    const rawJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
    if (rawJson) {
      const parsed = normalizeServiceAccountCredentials(JSON.parse(rawJson));
      setConfigError(null);
      return parsed;
    }

    const credentialsPath = String(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      || process.env.GOOGLE_APPLICATION_CREDENTIALS
      || ""
    ).trim();
    if (credentialsPath) {
      const content = fs.readFileSync(credentialsPath, "utf8");
      const parsed = normalizeServiceAccountCredentials(JSON.parse(content));
      setConfigError(null);
      return parsed;
    }
  } catch (error) {
    setConfigError(error);
    return null;
  }

  setConfigError(null);
  return null;
}

function resolveProjectId(credentials) {
  const envProjectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  if (envProjectId) {
    return envProjectId;
  }

  if (credentials && typeof credentials.project_id === "string") {
    return String(credentials.project_id).trim();
  }

  return "";
}

function hasFirestoreConfig() {
  const credentials = getCredentialsFromEnv();
  const projectId = resolveProjectId(credentials);
  return Boolean(credentials && projectId);
}

function getFirestoreConfigError() {
  return lastConfigError;
}

function initFirestore() {
  if (initialized) {
    return firestoreInstance;
  }

  const credentials = getCredentialsFromEnv();
  if (!credentials) {
    throw new Error("firestore_not_configured");
  }

  const projectId = resolveProjectId(credentials);
  if (!projectId) {
    throw new Error("firestore_not_configured");
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert(credentials),
      projectId
    });

    firestoreInstance = admin.firestore();
    initialized = true;
    setRuntimeError(null);
    return firestoreInstance;
  } catch (error) {
    setRuntimeError(error);
    throw error;
  }
}

async function pingFirestore() {
  try {
    const db = initFirestore();
    await db.collection("__healthcheck").limit(1).get();
    setRuntimeError(null);
  } catch (error) {
    setRuntimeError(error);
    throw error;
  }
}

function getFirestoreRuntimeError() {
  return lastRuntimeError;
}

function serializeSqliteRow(row) {
  const output = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (Buffer.isBuffer(value)) {
      output[key] = value.toString("base64");
      output[`${key}_encoding`] = "base64";
      continue;
    }
    output[key] = value;
  }
  return output;
}

async function mirrorTable(db, tableConfig) {
  const collectionName = String(tableConfig?.collection || "").trim();
  const idField = String(tableConfig?.idField || "id").trim();
  const rows = Array.isArray(tableConfig?.rows) ? tableConfig.rows : [];

  if (!collectionName || !idField) {
    throw new Error("invalid_firestore_table_config");
  }

  const collectionRef = db.collection(collectionName);
  const existingSnapshot = await collectionRef.select().get();
  const existingIds = new Set(existingSnapshot.docs.map((doc) => doc.id));
  const activeIds = new Set();

  let batch = db.batch();
  let operationCount = 0;

  const flushBatch = async () => {
    if (operationCount <= 0) {
      return;
    }
    await batch.commit();
    batch = db.batch();
    operationCount = 0;
  };

  for (const row of rows) {
    const rawId = row?.[idField];
    if (rawId === undefined || rawId === null || rawId === "") {
      continue;
    }

    const docId = String(rawId);
    activeIds.add(docId);
    existingIds.delete(docId);

    const normalized = serializeSqliteRow(row);
    batch.set(collectionRef.doc(docId), {
      ...normalized,
      _syncedAt: Date.now()
    });
    operationCount += 1;

    if (operationCount >= 450) {
      await flushBatch();
    }
  }

  await flushBatch();

  for (const staleId of existingIds) {
    batch.delete(collectionRef.doc(staleId));
    operationCount += 1;

    if (operationCount >= 450) {
      await flushBatch();
    }
  }

  await flushBatch();
}

async function mirrorSqliteTables(tableConfigs = []) {
  const db = initFirestore();
  const configs = Array.isArray(tableConfigs) ? tableConfigs : [];

  for (const tableConfig of configs) {
    await mirrorTable(db, tableConfig);
  }
}

async function fetchFirestoreTableRows(tableConfig = {}) {
  const db = initFirestore();
  const collectionName = String(tableConfig?.collection || "").trim();

  if (!collectionName) {
    throw new Error("invalid_firestore_table_config");
  }

  const snapshot = await db.collection(collectionName).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data() || {};
    if (data.id === undefined || data.id === null || data.id === "") {
      return {
        ...data,
        id: Number.isFinite(Number(doc.id)) ? Number(doc.id) : doc.id
      };
    }
    return data;
  });
}

async function fetchFirestoreTables(tableConfigs = []) {
  const configs = Array.isArray(tableConfigs) ? tableConfigs : [];
  const output = {};

  for (const tableConfig of configs) {
    const collectionName = String(tableConfig?.collection || "").trim();
    if (!collectionName) {
      continue;
    }
    output[collectionName] = await fetchFirestoreTableRows(tableConfig);
  }

  return output;
}

module.exports = {
  hasFirestoreConfig,
  getFirestoreConfigError,
  getFirestoreRuntimeError,
  pingFirestore,
  mirrorSqliteTables,
  fetchFirestoreTables
};