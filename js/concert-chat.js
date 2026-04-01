const themeToggle = document.getElementById("themeToggle");
const chatTitle = document.getElementById("chatTitle");
const chatStatus = document.getElementById("chatStatus");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

let activeConcertKey = "";
let activeArtist = "";
let currentUserId = 0;
let pollTimer = null;

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
	chatStatus.textContent = message;
	chatStatus.style.color = isError ? "#d65050" : "var(--muted)";
}

function getQueryParams() {
	const params = new URLSearchParams(window.location.search);
	return {
		concertKey: String(params.get("concertKey") || "").trim(),
		artist: String(params.get("artist") || "").trim()
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
	avatar.setAttribute("aria-hidden", "true");

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
	const wasNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 90;
	chatMessages.innerHTML = "";
	if (!Array.isArray(items) || !items.length) {
		chatMessages.innerHTML = '<p class="empty-result dm-empty-thread">Aucun message pour le moment. Lance la discussion.</p>';
		return;
	}

	items.forEach((item) => {
		const article = document.createElement("article");
		const isMine = Number(item?.userId || 0) === currentUserId;
		article.className = `chat-message dm-message ${isMine ? "dm-message-self" : "dm-message-other"}`;
		const when = formatDate(item.createdAt);
		const senderLabel = isMine ? "Toi" : String(item.username || "Utilisateur");

		const avatar = createAvatarElement(senderLabel, item?.senderAvatarUrl || "");

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

		bubbleHead.append(author, time);
		bubble.append(bubbleHead, text);
		article.append(avatar, bubble);
		chatMessages.appendChild(article);
	});

	if (wasNearBottom) {
		chatMessages.scrollTop = chatMessages.scrollHeight;
	}
}

async function readJsonSafely(response) {
	const rawText = await response.text();
	try {
		return { isJson: true, payload: JSON.parse(rawText || "{}") };
	} catch (e) {
		return { isJson: false, payload: null, rawText };
	}
}

async function fetchConcertMessages() {
	const token = window.WithMeAuth?.getStoredToken?.() || "";
	if (!token) {
		throw new Error("auth_required");
	}

	const params = new URLSearchParams({ concertKey: activeConcertKey, limit: "80" });
	const endpoints = [
		`/api/concert-chat/messages?${params.toString()}`,
		`/api/concert-chat/${encodeURIComponent(activeConcertKey)}/messages?limit=80`
	];

	let lastError = "";
	for (const endpoint of endpoints) {
		const response = await fetch(endpoint, {
			headers: { Authorization: `Bearer ${token}` }
		});

		if (response.status === 401) {
			throw new Error("auth_required");
		}

		const parsed = await readJsonSafely(response);
		if (response.ok && parsed.isJson) {
			return parsed.payload?.items || [];
		}

		if (parsed.isJson && parsed.payload?.error) {
			lastError = parsed.payload.error;
			continue;
		}

		lastError = `non_json_${response.status}`;
	}

	throw new Error(`load_failed:${lastError || "unreachable"}`);
}

async function postConcertMessage(message) {
	const token = window.WithMeAuth?.getStoredToken?.() || "";
	if (!token) {
		throw new Error("auth_required");
	}

	const attempts = [
		{
			url: "/api/concert-chat/messages",
			body: { concertKey: activeConcertKey, message }
		},
		{
			url: `/api/concert-chat/${encodeURIComponent(activeConcertKey)}/messages`,
			body: { message }
		}
	];

	let lastError = "";
	for (const attempt of attempts) {
		const response = await fetch(attempt.url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`
			},
			body: JSON.stringify(attempt.body)
		});

		if (response.status === 401) {
			throw new Error("auth_required");
		}

		if (response.ok) {
			return;
		}

		const parsed = await readJsonSafely(response);
		if (parsed.isJson && parsed.payload?.error) {
			lastError = parsed.payload.error;
			continue;
		}

		lastError = `non_json_${response.status}`;
	}

	throw new Error(`send_failed:${lastError || "unreachable"}`);
}

async function refreshChat(options = {}) {
	const silent = Boolean(options.silent);
	if (!silent) {
		setStatus("Chargement des messages...");
	}
	const items = await fetchConcertMessages();
	renderMessages(items);
	if (!silent) {
		setStatus(`Discussion de concert · ${items.length} message(s)`);
	}
}

function startPolling() {
	if (pollTimer) {
		clearInterval(pollTimer);
	}
	pollTimer = setInterval(() => {
		refreshChat({ silent: true }).catch(() => {});
	}, 3500);
}

chatForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const message = String(chatInput.value || "").trim();
	if (!message) {
		return;
	}

	try {
		chatInput.disabled = true;
		setStatus("Envoi du message...");
		await postConcertMessage(message);
		chatInput.value = "";
		await refreshChat({ silent: false });
	} catch (error) {
		if (String(error?.message || "") === "auth_required") {
			window.location.href = "/login.html";
			return;
		}
		const detail = String(error?.message || "").replace(/^send_failed:/, "");
		setStatus(`Impossible d'envoyer le message (${detail || "erreur inconnue"}).`, true);
	} finally {
		chatInput.disabled = false;
		chatInput.focus();
	}
});

if (themeToggle) {
	themeToggle.addEventListener("click", () => {
		const isDark = document.body.classList.contains("dark-mode");
		const nextTheme = isDark ? "light" : "dark";
		applyTheme(nextTheme);
		setCookie("WithMe-theme", nextTheme, 60 * 60 * 24 * 365);
	});
}

(async function bootConcertChatPage() {
	initTheme();
	const user = await window.WithMeAuth.requireAuthOrRedirect("/login.html");
	if (!user) {
		return;
	}
	currentUserId = Number(user?.id || 0);

	const params = getQueryParams();
	activeConcertKey = params.concertKey;
	activeArtist = params.artist || "Concert";

	if (!activeConcertKey) {
		setStatus("Concert invalide. Retourne a la page precedente.", true);
		chatForm.style.display = "none";
		return;
	}

	chatTitle.textContent = `Discussion de concert · ${activeArtist}`;
	try {
		await refreshChat({ silent: false });
		startPolling();
	} catch (error) {
		if (String(error?.message || "") === "auth_required") {
			window.location.href = "/login.html";
			return;
		}
		const detail = String(error?.message || "").replace(/^load_failed:/, "");
		setStatus(`Impossible de charger le chat de concert (${detail || "erreur inconnue"}).`, true);
	}
})();
