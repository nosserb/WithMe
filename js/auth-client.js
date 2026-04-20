(function () {
	const TOKEN_KEY = "WithMe-auth-token";
	const TOKEN_COOKIE_DAYS = 30;
	const USER_KEY = "WithMe-user";

	function getApiBaseUrl() {
		const configured = String(window.WITHME_CONFIG?.apiBaseUrl || "").trim();
		return configured.replace(/\/+$/, "");
	}

	function apiUrl(path) {
		const base = getApiBaseUrl();
		if (!base) {
			return path;
		}
		return `${base}${path}`;
	}

	function getStoredToken() {
		// Cherche d'abord dans le cookie persistant
		const value = getCookie(TOKEN_KEY);
		if (value) return value;
		// fallback legacy localStorage (pour migration)
		try {
			return localStorage.getItem(TOKEN_KEY) || "";
		} catch (e) {
			return "";
		}
	}

	function getStoredUser() {
		try {
			const raw = localStorage.getItem(USER_KEY) || "";
			if (!raw) {
				return null;
			}
			return JSON.parse(raw);
		} catch (e) {
			return null;
		}
	}

	function setStoredSession(token, user) {
		try {
			// Stocke le token dans un cookie persistant
			if (token) {
				const d = new Date();
				d.setTime(d.getTime() + TOKEN_COOKIE_DAYS * 24 * 60 * 60 * 1000);
				document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; expires="${d.toUTCString()}"; SameSite=Lax`;
			} else {
				document.cookie = `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`;
			}
			// Pour compatibilité, garde aussi dans localStorage
			localStorage.setItem(TOKEN_KEY, token || "");
			if (user) {
				localStorage.setItem(USER_KEY, JSON.stringify(user));
			}
		} catch (e) {}
	}

	function setStoredUser(user) {
		try {
			if (user) {
				localStorage.setItem(USER_KEY, JSON.stringify(user));
			}
		} catch (e) {}
	}

	function clearStoredSession() {
		try {
			localStorage.removeItem(TOKEN_KEY);
			localStorage.removeItem(USER_KEY);
		} catch (e) {}
		// Supprime le cookie du token
		document.cookie = `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`;
		document.cookie = "WithMe-code-verifier=; path=/; max-age=0; SameSite=Lax";
		document.cookie = "WithMe-oauth-state=; path=/; max-age=0; SameSite=Lax";
	}

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

	function getSpotifyStoredAuth() {
		let accessToken = "";
		let refreshToken = "";

		try {
			accessToken = localStorage.getItem("WithMe-spotify-access-token") || "";
			refreshToken = localStorage.getItem("WithMe-spotify-refresh-token") || "";
		} catch (e) {}

		if (!accessToken) {
			accessToken = getCookie("WithMe-spotify-access-token");
		}
		if (!refreshToken) {
			refreshToken = getCookie("WithMe-spotify-refresh-token");
		}

		return { accessToken, refreshToken };
	}

	function hasSpotifySession() {
		const stored = getSpotifyStoredAuth();
		return Boolean(stored.accessToken || stored.refreshToken);
	}

	function getLoginUrl() {
		const configured = String(
			window.WITHME_CONFIG?.spotifyRedirectUri
			|| window.WITHME_CONFIG?.redirectUri
			|| ""
		).trim();

		if (/^https?:\/\//i.test(configured)) {
			return configured;
		}

		if (configured.startsWith("/")) {
			return `${window.location.origin}${configured}`;
		}

		if (configured) {
			return new URL(configured, window.location.href).href;
		}

		return new URL("login.html", window.location.href).href;
	}

	function redirectToLogin(query = "") {
		const loginUrl = new URL(getLoginUrl(), window.location.href);
		const normalizedQuery = String(query || "").trim().replace(/^\?/, "");
		if (normalizedQuery) {
			for (const [key, value] of new URLSearchParams(normalizedQuery).entries()) {
				loginUrl.searchParams.set(key, value);
			}
		}
		window.location.href = loginUrl.toString();
	}

	async function apiRequest(path, options = {}) {
		const token = getStoredToken();
		const headers = {
			"Content-Type": "application/json",
			...(options.headers || {}),
			...(token ? { Authorization: `Bearer ${token}` } : {})
		};

		let response;
		try {
			response = await fetch(apiUrl(path), {
				method: options.method || "GET",
				headers,
				body: options.body ? JSON.stringify(options.body) : undefined
			});
		} catch (e) {
			const error = new Error("backend_unreachable");
			error.status = 0;
			throw error;
		}

		let payload = {};
		try {
			payload = await response.json();
		} catch (e) {
			payload = {};
		}

		if (!response.ok) {
			const fallbackMessage = payload?.error
				? String(payload.error)
				: `request_failed_${response.status}`;
			const error = new Error(fallbackMessage);
			error.status = response.status;
			throw error;
		}

		return payload;
	}

	async function register(username, email, password) {
		const payload = await apiRequest("/api/auth/register", {
			method: "POST",
			body: { username, email, password }
		});
		setStoredSession(payload.token, payload.user);
		return payload.user;
	}

	async function login(email, password) {
		const payload = await apiRequest("/api/auth/login", {
			method: "POST",
			body: { email, password }
		});
		setStoredSession(payload.token, payload.user);
		return payload.user;
	}

	async function me() {
		if (!getStoredToken()) {
			return getStoredUser();
		}
		const payload = await apiRequest("/api/auth/me", { method: "GET" });
		if (payload.user) {
			setStoredUser(payload.user);
		}
		return payload.user || null;
	}

	async function logout() {
		try {
			await apiRequest("/api/auth/logout", { method: "POST" });
		} catch (e) {}
		clearStoredSession();
	}

	async function linkSpotify(spotifyId, spotifyDisplayName) {
		const payload = await apiRequest("/api/spotify/link", {
			method: "POST",
			body: { spotifyId, spotifyDisplayName }
		});
		if (payload.user) {
			setStoredUser(payload.user);
		}
		return payload.user || null;
	}

	async function getProfile() {
		const payload = await apiRequest("/api/profile", { method: "GET" });
		if (payload.user) {
			setStoredUser(payload.user);
		}
		return payload.user || null;
	}

	async function updateProfile(fields) {
		const payload = await apiRequest("/api/profile", {
			method: "PUT",
			body: fields || {}
		});
		if (payload.user) {
			setStoredUser(payload.user);
		}
		return payload.user || null;
	}

	async function getFriends() {
		const payload = await apiRequest("/api/friends", { method: "GET" });
		return payload.items || [];
	}

	async function addFriend(userId) {
		const payload = await apiRequest(`/api/friends/${encodeURIComponent(userId)}`, {
			method: "POST"
		});
		return payload || { ok: false, alreadyFriend: false };
	}

	async function getFriendRequests() {
		const payload = await apiRequest("/api/friend-requests", { method: "GET" });
		return {
			incoming: payload?.incoming || [],
			outgoing: payload?.outgoing || []
		};
	}

	async function acceptFriendRequest(userId) {
		const payload = await apiRequest(`/api/friend-requests/${encodeURIComponent(userId)}/accept`, {
			method: "POST"
		});
		return payload || { ok: false, accepted: false };
	}

	async function declineFriendRequest(userId) {
		const payload = await apiRequest(`/api/friend-requests/${encodeURIComponent(userId)}`, {
			method: "DELETE"
		});
		return payload || { ok: false, action: "" };
	}

	async function getNotifications() {
		const payload = await apiRequest("/api/notifications", { method: "GET" });
		return {
			unreadCount: Number(payload?.unreadCount || 0),
			items: payload?.items || []
		};
	}

	async function removeFriend(userId) {
		const payload = await apiRequest(`/api/friends/${encodeURIComponent(userId)}`, {
			method: "DELETE"
		});
		return payload || { ok: false, removed: false };
	}

	async function requireAuthOrRedirect(redirectTo = getLoginUrl()) {
		const token = getStoredToken();
		if (!token) {
			window.location.href = redirectTo;
			return null;
		}

		try {
			const user = await me();
			if (!user) {
				clearStoredSession();
				window.location.href = redirectTo;
				return null;
			}
			return user;
		} catch (e) {
			clearStoredSession();
			window.location.href = redirectTo;
			return null;
		}
	}

	window.WithMeAuth = {
		getStoredToken,
		getStoredUser,
		getLoginUrl,
		redirectToLogin,
		setStoredSession,
		setStoredUser,
		clearStoredSession,
		register,
		login,
		me,
		logout,
		linkSpotify,
		getProfile,
		updateProfile,
		getFriends,
		addFriend,
		getFriendRequests,
		acceptFriendRequest,
		declineFriendRequest,
		getNotifications,
		removeFriend,
		hasSpotifySession,
		requireAuthOrRedirect
	};
})();
