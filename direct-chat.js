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
	const token = window.WithMeAuth?.getStoredToken?.() || "";
	if (!token) {
		throw new Error("auth_required");
	}

	const response = await fetch(`/api/private-chat/${encodeURIComponent(activeTargetUserId)}/messages?limit=120`, {
		headers: { Authorization: `Bearer ${token}` }
	});

	if (response.status === 401) {
		throw new Error("auth_required");
	}

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload?.error || "load_failed");
	}

	return payload?.items || [];
}

async function sendPrivateMessage(message) {
	const token = window.WithMeAuth?.getStoredToken?.() || "";
	if (!token) {
		throw new Error("auth_required");
	}

	const response = await fetch(`/api/private-chat/${encodeURIComponent(activeTargetUserId)}/messages`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`
		},
		body: JSON.stringify({ message })
	});

	if (response.status === 401) {
		throw new Error("auth_required");
	}

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload?.error || "send_failed");
	}
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
		setStatus("Chargement des messages...");
	}
	const items = await fetchPrivateMessages();
	renderMessages(items);
	if (!silent) {
		setStatus(`Discussion privee · ${items.length} message(s)`);
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
		setStatus("Envoi du message...");
		await sendPrivateMessage(message);
		dmChatInput.value = "";
		await refreshChat({ silent: false });
	} catch (error) {
		if (String(error?.message || "") === "auth_required") {
			window.location.href = "login.html";
			return;
		}
		if (String(error?.message || "") === "not_friends") {
			setStatus("Tu peux ecrire uniquement a tes amis.", true);
			return;
		}
		setStatus("Impossible d'envoyer le message.", true);
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
			window.location.href = "login.html";
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
	const user = await window.WithMeAuth.requireAuthOrRedirect("login.html");
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
		await refreshChat({ silent: false });
		startPolling();
	} catch (error) {
		const code = String(error?.message || "");
		if (code === "auth_required") {
			window.location.href = "login.html";
			return;
		}
		if (code === "not_friends") {
			setStatus("Tu ne peux discuter qu'avec tes amis.", true);
			dmChatForm.style.display = "none";
			return;
		}
		setStatus("Impossible de charger la discussion.", true);
	}
})();
