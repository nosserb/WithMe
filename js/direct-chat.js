const themeToggle = document.getElementById("themeToggle");
const dmChatTitle = document.getElementById("dmChatTitle");
const dmChatStatus = document.getElementById("dmChatStatus");
const dmChatMessages = document.getElementById("dmChatMessages");
const dmChatForm = document.getElementById("dmChatForm");
const dmChatInput = document.getElementById("dmChatInput");

let activeTargetUserId = 0;
let activeTargetUsername = "";
let currentUserId = 0;
let pollTimer = null;
let e2eeSession = {
	privateKey: null,
	publicKey: null,
	publicKeyJwkText: "",
	targetPublicKey: null,
	conversationKey: null,
	ready: false
};

function getCookie(name) {
	const parts = document.cookie ? document.cookie.split("; ") : [];
	for (const part of parts) {
		const [key, ...rest] = part.split("=");
		if (key === name) {
			return decodeURIComponent(rest.join("="));
		}
	}
	return "";
}

function setCookie(name, value, maxAgeSeconds) {
	document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
}

function applyTheme(mode) {
	const isDark = mode === "dark";
	document.body.classList.toggle("dark-mode", isDark);
	if (themeToggle) {
		themeToggle.textContent = isDark ? "Clair" : "Sombre";
	}
}

function initTheme() {
	const storedTheme = getCookie("WithMe-theme");
	const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
	applyTheme(storedTheme || (prefersDark ? "dark" : "light"));
}

function setStatus(message, isError = false) {
	dmChatStatus.textContent = message;
	dmChatStatus.style.color = isError ? "#d65050" : "var(--muted)";
}

function encodeUtf8(value) {
	return new TextEncoder().encode(String(value || ""));
}

function decodeUtf8(value) {
	return new TextDecoder().decode(value);
}

function getConversationWord() {
	const left = Math.min(Number(currentUserId || 0), Number(activeTargetUserId || 0));
	const right = Math.max(Number(currentUserId || 0), Number(activeTargetUserId || 0));
	return `withme-dm-${left}-${right}`;
}

function applyCaesarByWord(input, word, direction) {
	const text = String(input || "");
	const keyword = String(word || "");
	if (!text || !keyword) {
		return text;
	}

	const printableStart = 32;
	const printableEnd = 126;
	const printableRange = printableEnd - printableStart + 1;
	let keywordIndex = 0;
	let output = "";

	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		if (code < printableStart || code > printableEnd) {
			output += text[i];
			continue;
		}

		const keyCode = keyword.charCodeAt(keywordIndex % keyword.length);
		const shift = keyCode % printableRange;
		keywordIndex += 1;

		const offset = code - printableStart;
		const shifted = direction > 0
			? (offset + shift) % printableRange
			: (offset - shift + printableRange) % printableRange;

		output += String.fromCharCode(printableStart + shifted);
	}

	return output;
}

function obfuscateWithConversationWord(plainText) {
	return applyCaesarByWord(plainText, getConversationWord(), 1);
}

function deobfuscateWithConversationWord(obfuscatedText) {
	return applyCaesarByWord(obfuscatedText, getConversationWord(), -1);
}

function bytesToBase64(bytes) {
	let binary = "";
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	for (let i = 0; i < view.length; i += 1) {
		binary += String.fromCharCode(view[i]);
	}
	return btoa(binary);
}

function base64ToBytes(base64Value) {
	const normalized = String(base64Value || "").trim();
	if (!normalized) {
		throw new Error("invalid_base64");
	}
	const binary = atob(normalized);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function getKeyPairStorageKey() {
	return `withme:e2ee:keypair:v1:user:${currentUserId}`;
}

async function fetchJsonWithAuth(url, options = {}) {
	const token = window.WithMeAuth?.getStoredToken?.() || "";
	if (!token) {
		throw new Error("auth_required");
	}

	const response = await fetch(url, {
		...options,
		headers: {
			...(options.headers || {}),
			Authorization: `Bearer ${token}`
		}
	});

	if (response.status === 401) {
		throw new Error("auth_required");
	}

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload?.error || "request_failed");
	}

	return payload;
}

async function loadOrCreateLocalIdentityKeys() {
	if (!window.crypto?.subtle) {
		throw new Error("crypto_not_supported");
	}

	const storageKey = getKeyPairStorageKey();
	const stored = localStorage.getItem(storageKey);
	if (stored) {
		try {
			const parsed = JSON.parse(stored);
			const privateJwk = parsed?.privateJwk;
			const publicJwk = parsed?.publicJwk;
			const privateKey = await window.crypto.subtle.importKey(
				"jwk",
				privateJwk,
				{ name: "RSA-OAEP", hash: "SHA-256" },
				true,
				["decrypt"]
			);
			const publicKey = await window.crypto.subtle.importKey(
				"jwk",
				publicJwk,
				{ name: "RSA-OAEP", hash: "SHA-256" },
				true,
				["encrypt"]
			);
			return {
				privateKey,
				publicKey,
				publicKeyJwkText: JSON.stringify(publicJwk)
			};
		} catch (error) {
			localStorage.removeItem(storageKey);
		}
	}

	const keyPair = await window.crypto.subtle.generateKey(
		{
			name: "RSA-OAEP",
			hash: "SHA-256",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1])
		},
		true,
		["encrypt", "decrypt"]
	);

	const privateJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
	const publicJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);

	localStorage.setItem(
		storageKey,
		JSON.stringify({ privateJwk, publicJwk })
	);

	return {
		privateKey: keyPair.privateKey,
		publicKey: keyPair.publicKey,
		publicKeyJwkText: JSON.stringify(publicJwk)
	};
}

async function publishMyPublicKey(publicKeyJwkText) {
	const remoteKey = await fetchJsonWithAuth(`/api/e2ee/public-key/${encodeURIComponent(currentUserId)}`, {
		method: "GET"
	}).catch((error) => {
		if (String(error?.message || "") === "public_key_not_found") {
			return null;
		}
		throw error;
	});

	if (remoteKey?.publicKeyJwk === publicKeyJwkText) {
		return;
	}

	await fetchJsonWithAuth("/api/e2ee/public-key", {
		method: "PUT",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ publicKeyJwk: publicKeyJwkText })
	});
}

async function loadTargetPublicKey() {
	const payload = await fetchJsonWithAuth(`/api/e2ee/public-key/${encodeURIComponent(activeTargetUserId)}`, {
		method: "GET"
	});
	const targetJwk = JSON.parse(String(payload?.publicKeyJwk || ""));
	return window.crypto.subtle.importKey(
		"jwk",
		targetJwk,
		{ name: "RSA-OAEP", hash: "SHA-256" },
		true,
		["encrypt"]
	);
}

async function tryLoadExistingConversationKey() {
	if (e2eeSession.conversationKey) {
		return e2eeSession.conversationKey;
	}

	const payload = await fetchJsonWithAuth(`/api/private-chat/${encodeURIComponent(activeTargetUserId)}/e2ee-key`, {
		method: "GET"
	});

	if (!payload?.exists || !payload?.wrappedKey) {
		return null;
	}

	const wrappedKeyBuffer = base64ToBytes(payload.wrappedKey);
	e2eeSession.conversationKey = await window.crypto.subtle.unwrapKey(
		"raw",
		wrappedKeyBuffer,
		e2eeSession.privateKey,
		{ name: "RSA-OAEP" },
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);

	return e2eeSession.conversationKey;
}

async function ensureConversationKeyForSend() {
	const existing = await tryLoadExistingConversationKey();
	if (existing) {
		return existing;
	}

	if (!e2eeSession.targetPublicKey) {
		e2eeSession.targetPublicKey = await loadTargetPublicKey();
	}

	const aesKey = await window.crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt", "decrypt"]
	);

	const wrappedForSelf = await window.crypto.subtle.wrapKey(
		"raw",
		aesKey,
		e2eeSession.publicKey,
		{ name: "RSA-OAEP" }
	);
	const wrappedForPeer = await window.crypto.subtle.wrapKey(
		"raw",
		aesKey,
		e2eeSession.targetPublicKey,
		{ name: "RSA-OAEP" }
	);

	await fetchJsonWithAuth(`/api/private-chat/${encodeURIComponent(activeTargetUserId)}/e2ee-key`, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			wrappedKeyForSelf: bytesToBase64(new Uint8Array(wrappedForSelf)),
			wrappedKeyForPeer: bytesToBase64(new Uint8Array(wrappedForPeer))
		})
	});

	e2eeSession.conversationKey = aesKey;
	return aesKey;
}

async function encryptPrivateMessage(plainText) {
	const conversationKey = await ensureConversationKeyForSend();
	const iv = window.crypto.getRandomValues(new Uint8Array(12));
	const obfuscated = obfuscateWithConversationWord(plainText);
	const encrypted = await window.crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		conversationKey,
		encodeUtf8(obfuscated)
	);

	return {
		v: 2,
		pre: "caesar-id-v1",
		alg: "AES-GCM",
		iv: bytesToBase64(iv),
		ciphertext: bytesToBase64(new Uint8Array(encrypted))
	};
}

async function decryptPrivateMessage(payload) {
	if (!payload?.ciphertext || !payload?.iv) {
		return null;
	}

	const conversationKey = await tryLoadExistingConversationKey();
	if (!conversationKey) {
		return null;
	}

	try {
		const decrypted = await window.crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: base64ToBytes(payload.iv) },
			conversationKey,
			base64ToBytes(payload.ciphertext)
		);
		const clearText = decodeUtf8(new Uint8Array(decrypted));
		if (String(payload?.pre || "") === "caesar-id-v1") {
			return deobfuscateWithConversationWord(clearText);
		}
		return clearText;
	} catch (error) {
		return null;
	}
}

async function initializeE2ee() {
	const identity = await loadOrCreateLocalIdentityKeys();
	e2eeSession.privateKey = identity.privateKey;
	e2eeSession.publicKey = identity.publicKey;
	e2eeSession.publicKeyJwkText = identity.publicKeyJwkText;

	await publishMyPublicKey(identity.publicKeyJwkText);
	e2eeSession.targetPublicKey = await loadTargetPublicKey();
	await tryLoadExistingConversationKey();
	e2eeSession.ready = true;
}

async function resolveDisplayMessages(items) {
	if (!Array.isArray(items)) {
		return [];
	}

	const resolved = [];
	for (const item of items) {
		if (item?.encrypted) {
			const decrypted = await decryptPrivateMessage(item.encrypted);
			resolved.push({
				...item,
				message: decrypted || "[Message chiffre - impossible a lire]"
			});
			continue;
		}

		resolved.push(item);
	}

	return resolved;
}

function getQueryParams() {
	const params = new URLSearchParams(window.location.search);
	return {
		userId: Number(params.get("userId") || 0),
		username: String(params.get("username") || "").trim()
	};
}

function formatDate(ts) {
	const date = new Date(Number(ts || 0));
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	return date.toLocaleString("fr-FR", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit"
	});
}

function computeInitials(label) {
	return String(label || "")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() || "")
		.join("") || "U";
}

function createAvatarElement(senderLabel, senderAvatarUrl) {
	const avatar = document.createElement("div");
	avatar.className = "dm-avatar";

	const cleanedAvatarUrl = String(senderAvatarUrl || "").trim();
	const initials = computeInitials(senderLabel);

	if (!cleanedAvatarUrl) {
		avatar.textContent = initials;
		return avatar;
	}

	const img = document.createElement("img");
	img.src = cleanedAvatarUrl;
	img.alt = `Photo de ${String(senderLabel || "Utilisateur")}`;
	img.loading = "lazy";
	img.decoding = "async";
	img.addEventListener("error", () => {
		avatar.textContent = initials;
	});
	avatar.appendChild(img);

	return avatar;
}

function renderMessages(items) {
	const wasNearBottom = dmChatMessages.scrollHeight - dmChatMessages.scrollTop - dmChatMessages.clientHeight < 90;
	dmChatMessages.innerHTML = "";
	if (!Array.isArray(items) || !items.length) {
		dmChatMessages.innerHTML = '<p class="empty-result dm-empty-thread">Aucun message pour le moment. Lance la conversation.</p>';
		return;
	}

	items.forEach((item) => {
		const article = document.createElement("article");
		const isMine = Number(item?.senderId || 0) === currentUserId;
		article.className = `chat-message dm-message ${isMine ? "dm-message-self" : "dm-message-other"}`;
		article.dataset.messageId = String(Number(item?.id || 0));
		const when = formatDate(item.createdAt);
		const senderLabel = isMine ? "Toi" : String(item.senderUsername || "Utilisateur");

		const avatar = createAvatarElement(senderLabel, item?.senderAvatarUrl || "");
		avatar.setAttribute("aria-hidden", "true");

		const bubble = document.createElement("div");
		bubble.className = "dm-bubble";

		const bubbleHead = document.createElement("header");
		bubbleHead.className = "dm-bubble-head";

		const author = document.createElement("strong");
		author.className = "dm-author";
		author.textContent = senderLabel;

		const time = document.createElement("small");
		time.className = "dm-time";
		time.textContent = when;

		const text = document.createElement("p");
		text.className = "dm-text";
		text.textContent = String(item.message || "");

		if (isMine && Number(item?.id || 0) > 0) {
			const deleteBtn = document.createElement("button");
			deleteBtn.type = "button";
			deleteBtn.className = "dm-delete-btn";
			deleteBtn.dataset.deleteMessageId = String(Number(item.id));
			deleteBtn.textContent = "Supprimer";
			bubble.append(deleteBtn);
		}

		bubbleHead.append(author, time);
		bubble.prepend(bubbleHead, text);
		article.append(avatar, bubble);
		dmChatMessages.appendChild(article);
	});

	if (wasNearBottom) {
		dmChatMessages.scrollTop = dmChatMessages.scrollHeight;
	}
}

async function fetchPrivateMessages() {
	const payload = await fetchJsonWithAuth(`/api/private-chat/${encodeURIComponent(activeTargetUserId)}/messages?limit=120`, {
		method: "GET"
	});
	return payload?.items || [];
}

async function sendPrivateMessage(message) {
	const encrypted = await encryptPrivateMessage(message);
	await fetchJsonWithAuth(`/api/private-chat/${encodeURIComponent(activeTargetUserId)}/messages`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ encrypted })
	});
}

async function deletePrivateMessage(messageId) {
	const token = window.WithMeAuth?.getStoredToken?.() || "";
	if (!token) {
		throw new Error("auth_required");
	}

	const normalizedMessageId = Number(messageId || 0);
	if (!normalizedMessageId) {
		throw new Error("invalid_message_id");
	}

	const response = await fetch(
		`/api/private-chat/${encodeURIComponent(activeTargetUserId)}/messages/${encodeURIComponent(normalizedMessageId)}`,
		{
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${token}`
			}
		}
	);

	if (response.status === 401) {
		throw new Error("auth_required");
	}

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload?.error || "delete_failed");
	}
}

async function refreshChat(options = {}) {
	const silent = Boolean(options.silent);
	if (!silent) {
		setStatus("Chargement des messages chiffres...");
	}
	const items = await fetchPrivateMessages();
	const decryptedItems = await resolveDisplayMessages(items);
	renderMessages(decryptedItems);
	if (!silent) {
		setStatus(`Discussion privee chiffree · ${decryptedItems.length} message(s)`);
	}
}

dmChatForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const message = String(dmChatInput.value || "").trim();
	if (!message) {
		return;
	}

	try {
		dmChatInput.disabled = true;
		setStatus("Chiffrement et envoi du message...");
		await sendPrivateMessage(message);
		dmChatInput.value = "";
		await refreshChat({ silent: false });
	} catch (error) {
		if (String(error?.message || "") === "auth_required") {
			window.location.href = "/login.html";
			return;
		}
		if (String(error?.message || "") === "not_friends") {
			setStatus("Tu peux ecrire uniquement a tes amis.", true);
			return;
		}
		if (String(error?.message || "") === "public_key_not_found") {
			setStatus("Ton ami n'a pas encore active le chiffrement E2E.", true);
			return;
		}
		setStatus("Impossible d'envoyer le message chiffre.", true);
	} finally {
		dmChatInput.disabled = false;
		dmChatInput.focus();
	}
});

dmChatMessages.addEventListener("click", async (event) => {
	const target = event.target;
	if (!(target instanceof HTMLElement)) {
		return;
	}
	if (!target.matches("button[data-delete-message-id]")) {
		return;
	}

	const messageId = Number(target.dataset.deleteMessageId || 0);
	if (!messageId) {
		return;
	}

	target.setAttribute("disabled", "disabled");
	setStatus("Suppression du message...");

	try {
		await deletePrivateMessage(messageId);
		await refreshChat({ silent: false });
	} catch (error) {
		if (String(error?.message || "") === "auth_required") {
			window.location.href = "/login.html";
			return;
		}
		setStatus("Impossible de supprimer ce message.", true);
	} finally {
		target.removeAttribute("disabled");
	}
});

function startPolling() {
	if (pollTimer) {
		clearInterval(pollTimer);
	}
	pollTimer = setInterval(() => {
		refreshChat({ silent: true }).catch(() => {});
	}, 3500);
}

if (themeToggle) {
	themeToggle.addEventListener("click", () => {
		const isDark = document.body.classList.contains("dark-mode");
		const nextTheme = isDark ? "light" : "dark";
		applyTheme(nextTheme);
		setCookie("WithMe-theme", nextTheme, 60 * 60 * 24 * 365);
	});
}

(async function bootDirectChatPage() {
	initTheme();
	const user = await window.WithMeAuth.requireAuthOrRedirect("/login.html");
	if (!user) {
		return;
	}
	currentUserId = Number(user?.id || 0);

	const params = getQueryParams();
	activeTargetUserId = Number(params.userId || 0);
	activeTargetUsername = params.username || "Ami";

	if (!activeTargetUserId) {
		setStatus("Utilisateur invalide.", true);
		dmChatForm.style.display = "none";
		return;
	}

	dmChatTitle.textContent = `Discussion avec ${activeTargetUsername}`;

	try {
		await initializeE2ee();
		setStatus("Chiffrement de bout en bout actif.");

		await refreshChat({ silent: false });
		startPolling();
	} catch (error) {
		const code = String(error?.message || "");
		if (code === "auth_required") {
			window.location.href = "/login.html";
			return;
		}
		if (code === "not_friends") {
			setStatus("Tu ne peux discuter qu'avec tes amis.", true);
			dmChatForm.style.display = "none";
			return;
		}
		if (code === "public_key_not_found") {
			setStatus("Le chiffrement E2E n'est pas encore initialise pour cet ami.", true);
			dmChatForm.style.display = "none";
			return;
		}
		if (code === "crypto_not_supported") {
			setStatus("Ton navigateur ne supporte pas le chiffrement E2E requis.", true);
			dmChatForm.style.display = "none";
			return;
		}
		setStatus("Impossible de charger la discussion.", true);
	}
})();
