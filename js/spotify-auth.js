(function () {
	const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
	const SPOTIFY_DEFAULT_RETRY_MS = 15000;
	const SPOTIFY_RATE_LIMIT_KEY = "WithMe-spotify-rate-limited-until";

	function setCookie(name, value, maxAgeSeconds = COOKIE_MAX_AGE) {
		document.cookie = `${name}=${encodeURIComponent(value || "")}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
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

	function clearCookie(name) {
		document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
	}

	function getStoredValue(key) {
		try {
			const fromStorage = localStorage.getItem(key) || "";
			if (fromStorage) {
				return fromStorage;
			}
		} catch (e) {
			// Ignore and fallback to cookie.
		}
		return getCookie(key);
	}

	function setStoredValue(key, value) {
		const normalized = String(value || "");
		try {
			localStorage.setItem(key, normalized);
		} catch (e) {}
		setCookie(key, normalized);
	}

	function clearSpotifyStoredAuth() {
		try {
			localStorage.removeItem("WithMe-spotify-access-token");
			localStorage.removeItem("WithMe-spotify-refresh-token");
			localStorage.removeItem("WithMe-spotify-expires-at");
		} catch (e) {}

		clearCookie("WithMe-spotify-access-token");
		clearCookie("WithMe-spotify-refresh-token");
		clearCookie("WithMe-spotify-expires-at");
	}

	function getSpotifyRateLimitedUntil() {
		try {
			const raw = localStorage.getItem(SPOTIFY_RATE_LIMIT_KEY) || "0";
			const parsed = Number(raw);
			return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
		} catch (e) {
			return 0;
		}
	}

	function setSpotifyRateLimitedUntil(untilMs) {
		const value = Math.max(0, Number(untilMs) || 0);
		try {
			localStorage.setItem(SPOTIFY_RATE_LIMIT_KEY, String(value));
		} catch (e) {}
		setCookie(SPOTIFY_RATE_LIMIT_KEY, String(value));
	}

	function parseRetryAfterMs(response) {
		const raw = String(response?.headers?.get("Retry-After") || "").trim();
		if (!raw) {
			return SPOTIFY_DEFAULT_RETRY_MS;
		}

		const numeric = Number(raw);
		if (Number.isFinite(numeric) && numeric > 0) {
			return Math.max(1000, Math.round(numeric * 1000));
		}

		const dateMs = Date.parse(raw);
		if (Number.isFinite(dateMs)) {
			return Math.max(1000, dateMs - Date.now());
		}

		return SPOTIFY_DEFAULT_RETRY_MS;
	}

	async function refreshSpotifyAccessToken(refreshToken, clientId) {
		if (!refreshToken || !clientId) {
			return "";
		}

		const body = new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: clientId
		});

		const response = await fetch("https://accounts.spotify.com/api/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body
		});

		if (!response.ok) {
			return "";
		}

		const data = await response.json();
		const accessToken = data.access_token || "";
		if (accessToken) {
			setStoredValue("WithMe-spotify-access-token", accessToken);
			setStoredValue("WithMe-spotify-expires-at", String(Date.now() + ((data.expires_in || 3600) * 1000)));
			if (data.refresh_token) {
				setStoredValue("WithMe-spotify-refresh-token", data.refresh_token);
			}
		}

		return accessToken;
	}

	async function getValidSpotifyToken(clientId) {
		let accessToken = getStoredValue("WithMe-spotify-access-token");
		const refreshToken = getStoredValue("WithMe-spotify-refresh-token");
		const expiresAt = Number(getStoredValue("WithMe-spotify-expires-at") || "0");

		if (!accessToken && refreshToken) {
			const refreshed = await refreshSpotifyAccessToken(refreshToken, clientId);
			if (!refreshed) {
				clearSpotifyStoredAuth();
				return "";
			}
			accessToken = refreshed;
		}

		if (!accessToken) {
			return "";
		}

		if (expiresAt && Date.now() > (expiresAt - 20 * 1000)) {
			const refreshed = await refreshSpotifyAccessToken(refreshToken, clientId);
			if (!refreshed) {
				clearSpotifyStoredAuth();
				return "";
			}
			accessToken = refreshed;
		}

		return accessToken;
	}

	async function spotifyGet(path, accessToken) {
		if (Date.now() < getSpotifyRateLimitedUntil()) {
			throw new Error("spotify_error_429:rate_limited");
		}

		const response = await fetch(`https://api.spotify.com/v1${path}`, {
			headers: { Authorization: `Bearer ${accessToken}` }
		});

		if (response.status === 401) {
			throw new Error("spotify_unauthorized");
		}
		if (response.status === 429) {
			const retryMs = parseRetryAfterMs(response);
			setSpotifyRateLimitedUntil(Date.now() + retryMs);
			throw new Error(`spotify_error_429:retry_after_ms=${retryMs}`);
		}
		if (!response.ok) {
			let detail = "";
			try {
				const payload = await response.json();
				detail = payload?.error?.message || payload?.error_description || "";
			} catch (e) {
				detail = "";
			}
			throw new Error(`spotify_error_${response.status}${detail ? `:${detail}` : ""}`);
		}

		return response.json();
	}

	window.WithMeSpotify = {
		getStoredValue,
		setStoredValue,
		clearSpotifyStoredAuth,
		getSpotifyRateLimitedUntil,
		setSpotifyRateLimitedUntil,
		getValidSpotifyToken,
		spotifyGet
	};
})();
