(function () {
	function getStoredValue(key) {
		try {
			return localStorage.getItem(key) || "";
		} catch (e) {
			return "";
		}
	}

	function setStoredValue(key, value) {
		try {
			localStorage.setItem(key, value);
		} catch (e) {}
	}

	function clearSpotifyStoredAuth() {
		try {
			localStorage.removeItem("spoteur-spotify-access-token");
			localStorage.removeItem("spoteur-spotify-refresh-token");
			localStorage.removeItem("spoteur-spotify-expires-at");
		} catch (e) {}
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
			setStoredValue("spoteur-spotify-access-token", accessToken);
			setStoredValue("spoteur-spotify-expires-at", String(Date.now() + ((data.expires_in || 3600) * 1000)));
			if (data.refresh_token) {
				setStoredValue("spoteur-spotify-refresh-token", data.refresh_token);
			}
		}

		return accessToken;
	}

	async function getValidSpotifyToken(clientId) {
		let accessToken = getStoredValue("spoteur-spotify-access-token");
		const refreshToken = getStoredValue("spoteur-spotify-refresh-token");
		const expiresAt = Number(getStoredValue("spoteur-spotify-expires-at") || "0");

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
		const response = await fetch(`https://api.spotify.com/v1${path}`, {
			headers: { Authorization: `Bearer ${accessToken}` }
		});

		if (response.status === 401) {
			throw new Error("spotify_unauthorized");
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

	window.spoteurSpotify = {
		getStoredValue,
		setStoredValue,
		clearSpotifyStoredAuth,
		getValidSpotifyToken,
		spotifyGet
	};
})();
