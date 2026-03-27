const playToggle = document.getElementById("playToggle");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const progressFill = document.getElementById("progressFill");
const playerCurrentTime = document.getElementById("playerCurrentTime");
const playerDuration = document.getElementById("playerDuration");
const playerTitle = document.getElementById("playerTitle");
const playerArtist = document.getElementById("playerArtist");
const playerCover = document.getElementById("playerCover");
const themeToggle = document.getElementById("themeToggle");
const welcomeTitle = document.getElementById("welcomeTitle");
const greetLine = document.getElementById("greetLine");
const rankingList = document.getElementById("rankingList");

const focusCover = document.getElementById("focusCover");
const focusTitle = document.getElementById("focusTitle");
const focusArtist = document.getElementById("focusArtist");
const focusListeners = document.getElementById("focusListeners");

const quickCards = Array.from(document.querySelectorAll(".quick-card"));
const albumCards = Array.from(document.querySelectorAll(".album-card"));
const selectableCards = document.querySelectorAll(".quick-card, .album-card");

let isPlaying = false;
let progress = 0;
let progressMs = 0;
let durationMs = 0;
let timer = null;
let playerPollTimer = null;
let spotifyControlEnabled = false;
const SPOTIFY_CLIENT_ID = window.SPOTEUR_CONFIG?.spotifyClientId || "";

function setCookie(name, value, maxAgeSeconds) {
	document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
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

function applyTheme(mode) {
	const isDark = mode === "dark";
	document.body.classList.toggle("dark-mode", isDark);
	if (themeToggle) {
		themeToggle.textContent = isDark ? "Clair" : "Sombre";
		themeToggle.setAttribute("aria-label", isDark ? "Activer le mode clair" : "Activer le mode sombre");
	}
}

function initTheme() {
	const storedTheme = getCookie("spoteur-theme");
	const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
	const initialTheme = storedTheme || (prefersDark ? "dark" : "light");
	applyTheme(initialTheme);
}

function setPlaybackState(playing) {
	isPlaying = playing;
	playToggle.textContent = isPlaying ? "Pause" : "Lecture";
}

function formatDuration(ms) {
	const totalSec = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
	const minutes = Math.floor(totalSec / 60);
	const seconds = String(totalSec % 60).padStart(2, "0");
	return `${minutes}:${seconds}`;
}

function setProgressValues(currentMs, totalMs) {
	progressMs = Math.max(0, Number(currentMs) || 0);
	durationMs = Math.max(0, Number(totalMs) || 0);
	if (durationMs > 0) {
		progress = Math.min(100, (progressMs / durationMs) * 100);
	} else {
		progress = 0;
	}
	progressFill.style.width = `${progress}%`;
	if (playerCurrentTime) {
		playerCurrentTime.textContent = formatDuration(progressMs);
	}
	if (playerDuration) {
		playerDuration.textContent = formatDuration(durationMs);
	}
}

function tickProgress() {
	if (!isPlaying) {
		return;
	}
	if (durationMs <= 0) {
		return;
	}

	setProgressValues(progressMs + 280, durationMs);
}

function startProgressLoop() {
	if (timer) {
		clearInterval(timer);
	}
	timer = setInterval(tickProgress, 140);
}

function updateFocusPanel(title, artist, cover) {
	focusCover.src = cover;
	focusTitle.textContent = title;
	focusArtist.textContent = artist;
	focusListeners.textContent = "Live listeners estimate available soon";
}

function initWelcome() {
	const cookieName = getCookie("spoteur-display-name").trim();
	let displayName = cookieName;
	if (!displayName) {
		try {
			displayName = (localStorage.getItem("spoteur-display-name") || "").trim();
		} catch (e) {
			displayName = "";
		}
	}

	if (!displayName) {
		return;
	}

	if (welcomeTitle) {
		welcomeTitle.textContent = `Bonjour, ${displayName}`;
	}

	if (greetLine) {
		greetLine.textContent = `Bonjour, ${displayName}`;
	}
}

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

function clearCookie(name) {
	document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

function clearSpotifyStoredAuth() {
	try {
		localStorage.removeItem("spoteur-spotify-access-token");
		localStorage.removeItem("spoteur-spotify-refresh-token");
		localStorage.removeItem("spoteur-spotify-expires-at");
	} catch (e) {}
}

async function refreshSpotifyAccessToken(refreshToken) {
	if (!refreshToken || !SPOTIFY_CLIENT_ID) {
		return "";
	}

	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		client_id: SPOTIFY_CLIENT_ID
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
	const nextAccessToken = data.access_token || "";
	if (nextAccessToken) {
		setStoredValue("spoteur-spotify-access-token", nextAccessToken);
		setStoredValue("spoteur-spotify-expires-at", String(Date.now() + ((data.expires_in || 3600) * 1000)));
		if (data.refresh_token) {
			setStoredValue("spoteur-spotify-refresh-token", data.refresh_token);
		}
	}

	return nextAccessToken;
}

async function getValidSpotifyToken() {
	let accessToken = getStoredValue("spoteur-spotify-access-token");
	const refreshToken = getStoredValue("spoteur-spotify-refresh-token");
	const expiresAtRaw = getStoredValue("spoteur-spotify-expires-at");
	const expiresAt = Number(expiresAtRaw || "0");

	if (!accessToken) {
		return "";
	}

	if (expiresAt && Date.now() > (expiresAt - 20 * 1000)) {
		const refreshed = await refreshSpotifyAccessToken(refreshToken);
		if (!refreshed) {
			clearSpotifyStoredAuth();
			return "";
		}
		accessToken = refreshed;
	}

	return accessToken;
}

function getQueryParam(param) {
	return new URLSearchParams(window.location.search).get(param) || "";
}

function getSpotifyRedirectUriForHost() {
	const configRedirectUri = String(window.SPOTEUR_CONFIG?.redirectUri || "").trim();
	const configLocalRedirectUri = String(window.SPOTEUR_CONFIG?.localRedirectUri || "").trim();
	const isLocal = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
	const fallbackCurrentPage = `${window.location.origin}${window.location.pathname}`;
	return (isLocal ? configLocalRedirectUri : configRedirectUri) || fallbackCurrentPage;
}

async function exchangeSpotifyCodeForToken(code, verifier) {
	if (!SPOTIFY_CLIENT_ID) {
		throw new Error("spotify_client_id_missing");
	}

	const redirectUri = getSpotifyRedirectUriForHost();
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code,
		redirect_uri: redirectUri,
		client_id: SPOTIFY_CLIENT_ID,
		code_verifier: verifier
	});

	const response = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body
	});

	if (!response.ok) {
		let detail = "";
		try {
			const payload = await response.json();
			detail = payload?.error_description || payload?.error || "";
		} catch (e) {
			detail = "";
		}
		throw new Error(`spotify_oauth_exchange_failed${detail ? `:${detail}` : ""}`);
	}

	return response.json();
}

async function handleSpotifyOAuthCallbackOnHome() {
	const code = getQueryParam("code");
	const state = getQueryParam("state");
	const oauthError = getQueryParam("error");

	if (!code && !oauthError) {
		return;
	}

	if (oauthError) {
		history.replaceState({}, document.title, window.location.pathname);
		return;
	}

	try {
		const expectedState = sessionStorage.getItem("spoteur-oauth-state") || getCookie("spoteur-oauth-state");
		if (!expectedState || expectedState !== state) {
			throw new Error("spotify_oauth_state_invalid");
		}

		const verifier = sessionStorage.getItem("spoteur-code-verifier") || getCookie("spoteur-code-verifier");
		if (!verifier) {
			throw new Error("spotify_oauth_verifier_missing");
		}

		const tokenData = await exchangeSpotifyCodeForToken(code, verifier);
		setStoredValue("spoteur-spotify-access-token", tokenData.access_token || "");
		setStoredValue("spoteur-spotify-refresh-token", tokenData.refresh_token || "");
		setStoredValue("spoteur-spotify-expires-at", String(Date.now() + ((tokenData.expires_in || 3600) * 1000)));

		if (tokenData.access_token) {
			try {
				const profile = await spotifyGet("/me", tokenData.access_token);
				const displayName = profile?.display_name || profile?.id || "";
				if (displayName) {
					setCookie("spoteur-display-name", displayName, 60 * 60 * 24 * 365);
					setStoredValue("spoteur-display-name", displayName);
				}
			} catch (e) {}
		}
	} catch (e) {
		clearSpotifyStoredAuth();
	} finally {
		sessionStorage.removeItem("spoteur-code-verifier");
		sessionStorage.removeItem("spoteur-oauth-state");
		clearCookie("spoteur-code-verifier");
		clearCookie("spoteur-oauth-state");
		history.replaceState({}, document.title, window.location.pathname);
	}
}

async function spotifyGet(path, accessToken) {
	const response = await fetch(`https://api.spotify.com/v1${path}`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (response.status === 401) {
		throw new Error("spotify_unauthorized");
	}

	if (!response.ok) {
		throw new Error(`spotify_error_${response.status}`);
	}

	return response.json();
}

function setCardData(card, item) {
	if (!card || !item) {
		return;
	}

	const img = card.querySelector("img");
	const titleEl = card.querySelector("span, h4");
	const artistEl = card.querySelector("p");

	const cover = item.cover || card.dataset.cover || "";
	const title = item.title || card.dataset.title || "Titre";
	const artist = item.artist || card.dataset.artist || "Artiste";

	card.dataset.title = title;
	card.dataset.artist = artist;
	card.dataset.cover = cover;

	if (img && cover) {
		img.src = cover;
		img.alt = title;
	}

	if (titleEl) {
		titleEl.textContent = title;
	}

	if (artistEl) {
		artistEl.textContent = artist;
	}
}

function mapTrackItem(track) {
	if (!track) {
		return null;
	}
	const firstArtist = track.artists?.[0]?.name || "Artiste";
	const cover = track.album?.images?.[0]?.url || "";
	return {
		title: track.name || "Titre",
		artist: firstArtist,
		cover,
		uri: track.uri || ""
	};
}

function mapNowPlayingTrack(track) {
	if (!track) {
		return null;
	}
	return {
		title: track.name || "Titre",
		artist: (track.artists || []).map((a) => a?.name).filter(Boolean).join(", ") || "Artiste",
		cover: track.album?.images?.[0]?.url || "",
		uri: track.uri || ""
	};
}

function renderPlayerTrack(track) {
	if (!track) {
		playerTitle.textContent = "Aucune lecture en cours";
		playerArtist.textContent = "Lance une musique sur Spotify";
		return;
	}

	playerTitle.textContent = track.title;
	playerArtist.textContent = track.artist;
	if (track.cover) {
		playerCover.src = track.cover;
	}
}

async function spotifyRequest(path, accessToken, method = "GET", body) {
	const response = await fetch(`https://api.spotify.com/v1${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			...(body ? { "Content-Type": "application/json" } : {})
		},
		...(body ? { body: JSON.stringify(body) } : {})
	});

	if (response.status === 401) {
		throw new Error("spotify_unauthorized");
	}

	if (response.status === 204) {
		return null;
	}

	if (!response.ok) {
		let detail = "";
		try {
			const payload = await response.json();
			detail = payload?.error?.message || "";
		} catch (e) {
			detail = "";
		}
		throw new Error(`spotify_error_${response.status}${detail ? `:${detail}` : ""}`);
	}

	if (response.status === 202) {
		return null;
	}

	return response.json();
}

function setControlsDisabled(disabled) {
	if (playToggle) {
		playToggle.disabled = disabled;
	}
	if (prevBtn) {
		prevBtn.disabled = disabled;
	}
	if (nextBtn) {
		nextBtn.disabled = disabled;
	}
}

function parseSpotifyApiError(error) {
	const msg = String(error?.message || "");
	const parsed = msg.match(/^spotify_error_(\d+)(?::(.*))?$/);
	return {
		status: Number(parsed?.[1] || 0),
		detail: parsed?.[2] || ""
	};
}

async function syncNowPlayingFromSpotify() {
	const token = await getValidSpotifyToken();
	if (!token) {
		spotifyControlEnabled = false;
		setControlsDisabled(true);
		return;
	}

	try {
		const current = await spotifyRequest("/me/player/currently-playing", token);
		if (!current || !current.item) {
			spotifyControlEnabled = true;
			setControlsDisabled(false);
			setPlaybackState(false);
			renderPlayerTrack(null);
			setProgressValues(0, 0);
			return;
		}

		const mapped = mapNowPlayingTrack(current.item);
		renderPlayerTrack(mapped);
		setPlaybackState(Boolean(current.is_playing));
		setProgressValues(current.progress_ms || 0, current.item.duration_ms || 0);
		spotifyControlEnabled = true;
		setControlsDisabled(false);
	} catch (error) {
		if (String(error?.message || "").includes("spotify_unauthorized")) {
			clearSpotifyStoredAuth();
			spotifyControlEnabled = false;
			setControlsDisabled(true);
			return;
		}

		const { status } = parseSpotifyApiError(error);
		if (status === 403) {
			spotifyControlEnabled = false;
			setControlsDisabled(true);
			playerArtist.textContent = "Reconnecte-toi pour activer la vraie lecture";
			return;
		}
		if (status === 404) {
			spotifyControlEnabled = true;
			setControlsDisabled(false);
			setPlaybackState(false);
			renderPlayerTrack(null);
			setProgressValues(0, 0);
			return;
		}
	}
}

async function toggleSpotifyPlayback() {
	if (!spotifyControlEnabled) {
		return;
	}
	const token = await getValidSpotifyToken();
	if (!token) {
		return;
	}

	try {
		if (isPlaying) {
			await spotifyRequest("/me/player/pause", token, "PUT");
			setPlaybackState(false);
		} else {
			await spotifyRequest("/me/player/play", token, "PUT");
			setPlaybackState(true);
		}
		await syncNowPlayingFromSpotify();
	} catch (error) {
		await syncNowPlayingFromSpotify();
	}
}

async function skipSpotifyTrack(direction) {
	if (!spotifyControlEnabled) {
		return;
	}
	const token = await getValidSpotifyToken();
	if (!token) {
		return;
	}

	const path = direction === "next" ? "/me/player/next" : "/me/player/previous";
	try {
		await spotifyRequest(path, token, "POST");
		setTimeout(() => {
			syncNowPlayingFromSpotify();
		}, 350);
	} catch (error) {
		await syncNowPlayingFromSpotify();
	}
}

function startPlayerPolling() {
	if (playerPollTimer) {
		clearInterval(playerPollTimer);
	}
	playerPollTimer = setInterval(() => {
		syncNowPlayingFromSpotify();
	}, 7000);
}

function mapArtistRankingItem(artist) {
	return {
		name: artist?.name || "Artiste",
		popularity: artist?.popularity || 0,
		followers: artist?.followers?.total || 0,
		cover: artist?.images?.[0]?.url || ""
	};
}

function renderRanking(artists) {
	if (!rankingList || !artists?.length) {
		return;
	}

	rankingList.innerHTML = "";
	artists.slice(0, 5).forEach((artist, index) => {
		const li = document.createElement("li");
		li.innerHTML = `<span>#${index + 1}</span><strong>${artist.name}</strong><em>Pop: ${artist.popularity}</em>`;
		rankingList.appendChild(li);
	});
}

function renderFocusArtist(artist) {
	if (!artist) {
		return;
	}

	if (focusCover && artist.cover) {
		focusCover.src = artist.cover;
	}
	if (focusTitle) {
		focusTitle.textContent = artist.name;
	}
	if (focusArtist) {
		focusArtist.textContent = "Top artiste";
	}
	if (focusListeners) {
		focusListeners.textContent = `${new Intl.NumberFormat("fr-FR").format(artist.followers)} auditeurs / followers`;
	}
}

async function initSpotifyHomeData() {
	const token = await getValidSpotifyToken();
	if (!token) {
		return;
	}

	try {
		const settled = await Promise.allSettled([
			spotifyGet("/me", token),
			spotifyGet("/me/top/tracks?limit=6&time_range=short_term", token),
			spotifyGet("/me/player/recently-played?limit=4", token),
			spotifyGet("/me/top/artists?limit=5&time_range=short_term", token)
		]);

		const profile = settled[0].status === "fulfilled" ? settled[0].value : null;
		const topTracksRes = settled[1].status === "fulfilled" ? settled[1].value : null;
		const recentRes = settled[2].status === "fulfilled" ? settled[2].value : null;
		const topArtistsRes = settled[3].status === "fulfilled" ? settled[3].value : null;

		const displayName = profile?.display_name || profile?.id || "";
		if (displayName) {
			setCookie("spoteur-display-name", displayName, 60 * 60 * 24 * 365);
			setStoredValue("spoteur-display-name", displayName);
			initWelcome();
		}

		const topTracks = (topTracksRes?.items || []).map(mapTrackItem).filter(Boolean);
		const recentTracks = (recentRes?.items || []).map((item) => mapTrackItem(item?.track)).filter(Boolean);
		const topArtists = (topArtistsRes?.items || []).map(mapArtistRankingItem);

		quickCards.forEach((card, index) => {
			if (topTracks[index]) {
				setCardData(card, topTracks[index]);
			}
		});

		albumCards.forEach((card, index) => {
			if (recentTracks[index]) {
				setCardData(card, recentTracks[index]);
			}
		});

		if (topArtists.length) {
			renderRanking(topArtists);
			renderFocusArtist(topArtists[0]);
		}

		const firstPlayable = recentTracks[0] || topTracks[0];
		if (firstPlayable) {
			renderPlayerTrack(firstPlayable);
		}

		await syncNowPlayingFromSpotify();
	} catch (error) {
		if (String(error?.message || "").includes("spotify_unauthorized")) {
			clearSpotifyStoredAuth();
		}
	}
}

playToggle.addEventListener("click", () => {
	toggleSpotifyPlayback();
});

if (prevBtn) {
	prevBtn.addEventListener("click", () => {
		skipSpotifyTrack("previous");
	});
}

if (nextBtn) {
	nextBtn.addEventListener("click", () => {
		skipSpotifyTrack("next");
	});
}

selectableCards.forEach((card) => {
	card.addEventListener("click", () => {
		const title = card.dataset.title || "Unknown title";
		const artist = card.dataset.artist || "Unknown artist";
		const cover = card.dataset.cover || "";

		renderPlayerTrack({ title, artist, cover });
		if (cover) {
			updateFocusPanel(title, artist, cover);
		}

		setProgressValues(0, 0);
	});
});

if (themeToggle) {
	themeToggle.addEventListener("click", () => {
		const isDark = document.body.classList.contains("dark-mode");
		const nextTheme = isDark ? "light" : "dark";
		applyTheme(nextTheme);
		setCookie("spoteur-theme", nextTheme, 60 * 60 * 24 * 365);
	});
}

(async function bootHomePage() {
	initTheme();
	await handleSpotifyOAuthCallbackOnHome();
	initWelcome();
	initSpotifyHomeData();
	startProgressLoop();
	startPlayerPolling();
	syncNowPlayingFromSpotify();
})();
