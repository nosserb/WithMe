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
const headerProfileAvatar = document.getElementById("headerProfileAvatar");
const headerProfileName = document.getElementById("headerProfileName");
const headerProfileEmail = document.getElementById("headerProfileEmail");
const welcomeTitle = document.getElementById("welcomeTitle");
const greetLine = document.getElementById("greetLine");
const concertsList = document.getElementById("concertsList");
const dmFriendsList = document.getElementById("dmFriendsList");
const dmFriendsMeta = document.getElementById("dmFriendsMeta");

const focusCover = document.getElementById("focusCover");
const focusTitle = document.getElementById("focusTitle");
const focusArtist = document.getElementById("focusArtist");
const focusListeners = document.getElementById("focusListeners");

const quickCards = Array.from(document.querySelectorAll(".quick-card"));
const albumCards = Array.from(document.querySelectorAll(".album-card"));
const playlistMenuLinks = Array.from(document.querySelectorAll(".js-playlist-link"));
const selectableCards = document.querySelectorAll(".quick-card, .album-card");
const PROFILE_FALLBACK_AVATAR = "img/artist-focus.svg";

let isPlaying = false;
let progress = 0;
let progressMs = 0;
let durationMs = 0;
let timer = null;
let playerPollTimer = null;
let spotifyControlEnabled = false;
let spotifyRateLimitedUntil = 0;
let ticketmasterRateLimitedUntil = 0;
const SPOTIFY_RATE_LIMIT_KEY = "WithMe-spotify-rate-limited-until";
const SPOTIFY_CLIENT_ID = window.WITHME_CONFIG?.spotifyClientId || "";
const SPOTIFY_DEFAULT_RETRY_MS = 15000;
const SPOTIFY_HOME_CACHE_TTL_MS = 10 * 60 * 1000;
const SPOTIFY_PROFILE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CONCERTS_CACHE_TTL_MS = 30 * 60 * 1000;
const TICKETMASTER_KEY = String(
	window.WITHME_CONFIG?.TicketmasterKey
	|| window.WITHME_CONFIG?.ticketmasterKey
	|| window.WITHME_CONFIG?.ticketmasterApiKey
	|| ""
).trim();

function readJsonCache(key, ttlMs) {
	if (!key || !ttlMs) {
		return null;
	}
	try {
		const raw = localStorage.getItem(key) || "";
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw);
		if (!parsed || !Number(parsed.expiresAt) || Date.now() > Number(parsed.expiresAt)) {
			localStorage.removeItem(key);
			return null;
		}
		return parsed.value;
	} catch (e) {
		return null;
	}
}

function writeJsonCache(key, value, ttlMs) {
	if (!key || !ttlMs) {
		return;
	}
	try {
		localStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
	} catch (e) {}
}

function getSpotifyRateLimitedUntil() {
	try {
		const raw = localStorage.getItem(SPOTIFY_RATE_LIMIT_KEY) || "0";
		const parsed = Number(raw);
		const storageUntil = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
		return Math.max(storageUntil, spotifyRateLimitedUntil);
	} catch (e) {
		return spotifyRateLimitedUntil;
	}
}

function setSpotifyRateLimitedUntil(untilMs) {
	spotifyRateLimitedUntil = Math.max(spotifyRateLimitedUntil, Math.max(0, Number(untilMs) || 0));
	try {
		localStorage.setItem(SPOTIFY_RATE_LIMIT_KEY, String(spotifyRateLimitedUntil));
	} catch (e) {}
}

async function spotifyGetCached(path, accessToken, cacheKey, ttlMs) {
	try {
		const data = await spotifyGet(path, accessToken);
		if (cacheKey && ttlMs && data) {
			writeJsonCache(cacheKey, data, ttlMs);
		}
		return data;
	} catch (error) {
		const { status } = parseSpotifyApiError(error);
		if (status === 429 || String(error?.message || "").includes("rate_limited")) {
			return readJsonCache(cacheKey, ttlMs);
		}
		throw error;
	}
}

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
	const storedTheme = getCookie("WithMe-theme");
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
	if (!focusCover || !focusTitle || !focusArtist || !focusListeners) {
		return;
	}
	focusCover.src = cover;
	focusTitle.textContent = title;
	focusArtist.textContent = artist;
	focusListeners.textContent = "Live listeners estimate available soon";
}

function applyHeaderProfile(profile) {
	if (!headerProfileName || !headerProfileEmail || !headerProfileAvatar) {
		return;
	}

	const username = String(profile?.username || "").trim() || "Mon profil";
	const email = String(profile?.email || "").trim() || "Compte WithMe";
	const avatarUrl = String(profile?.avatarUrl || "").trim() || PROFILE_FALLBACK_AVATAR;

	headerProfileName.textContent = username;
	headerProfileEmail.textContent = email;
	headerProfileAvatar.src = avatarUrl;
	headerProfileAvatar.alt = `Photo de ${username}`;
}

async function initHeaderProfile() {
	if (!window.WithMeAuth || !headerProfileName || !headerProfileEmail || !headerProfileAvatar) {
		return;
	}

	try {
		const profile = await window.WithMeAuth.getProfile();
		if (profile) {
			applyHeaderProfile(profile);
			return;
		}
	} catch (e) {}

	try {
		const stored = window.WithMeAuth.getStoredUser();
		if (stored) {
			applyHeaderProfile(stored);
		}
	} catch (e) {}
}

function initWelcome() {
	const cookieName = getCookie("WithMe-display-name").trim();
	let displayName = cookieName;
	if (!displayName) {
		try {
			displayName = (localStorage.getItem("WithMe-display-name") || "").trim();
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
	setCookie(key, normalized, 60 * 60 * 24 * 365);
}

function clearCookie(name) {
	document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
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
		setStoredValue("WithMe-spotify-access-token", nextAccessToken);
		setStoredValue("WithMe-spotify-expires-at", String(Date.now() + ((data.expires_in || 3600) * 1000)));
		if (data.refresh_token) {
			setStoredValue("WithMe-spotify-refresh-token", data.refresh_token);
		}
	}

	return nextAccessToken;
}

async function getValidSpotifyToken() {
	let accessToken = getStoredValue("WithMe-spotify-access-token");
	const refreshToken = getStoredValue("WithMe-spotify-refresh-token");
	const expiresAtRaw = getStoredValue("WithMe-spotify-expires-at");
	const expiresAt = Number(expiresAtRaw || "0");

	if (!accessToken && refreshToken) {
		const refreshed = await refreshSpotifyAccessToken(refreshToken);
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
	const candidate = String(
		window.WITHME_CONFIG?.spotifyRedirectUri
		|| window.WITHME_CONFIG?.localRedirectUri
		|| window.WITHME_CONFIG?.redirectUri
		|| ""
	).trim();
	if (/^https:\/\//i.test(candidate)) {
		return candidate;
	}
	throw new Error("spotify_redirect_uri_insecure");
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
		const expectedState = sessionStorage.getItem("WithMe-oauth-state") || getCookie("WithMe-oauth-state");
		if (!expectedState || expectedState !== state) {
			throw new Error("spotify_oauth_state_invalid");
		}

		const verifier = sessionStorage.getItem("WithMe-code-verifier") || getCookie("WithMe-code-verifier");
		if (!verifier) {
			throw new Error("spotify_oauth_verifier_missing");
		}

		const tokenData = await exchangeSpotifyCodeForToken(code, verifier);
		setStoredValue("WithMe-spotify-access-token", tokenData.access_token || "");
		setStoredValue("WithMe-spotify-refresh-token", tokenData.refresh_token || "");
		setStoredValue("WithMe-spotify-expires-at", String(Date.now() + ((tokenData.expires_in || 3600) * 1000)));

		if (tokenData.access_token) {
			const knownName = String(getStoredValue("WithMe-display-name") || "").trim();
			if (knownName) {
				setCookie("WithMe-display-name", knownName, 60 * 60 * 24 * 365);
			}
		}
	} catch (e) {
		clearSpotifyStoredAuth();
	} finally {
		sessionStorage.removeItem("WithMe-code-verifier");
		sessionStorage.removeItem("WithMe-oauth-state");
		clearCookie("WithMe-code-verifier");
		clearCookie("WithMe-oauth-state");
		history.replaceState({}, document.title, window.location.pathname);
	}
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
	if (Date.now() < getSpotifyRateLimitedUntil()) {
		throw new Error("spotify_error_429:rate_limited");
	}

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

	if (response.status === 429) {
		const retryMs = parseRetryAfterMs(response);
		setSpotifyRateLimitedUntil(Date.now() + retryMs);
		throw new Error(`spotify_error_429:retry_after_ms=${retryMs}`);
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
	if (Date.now() < getSpotifyRateLimitedUntil()) {
		return;
	}

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
		if (status === 429) {
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
	}, 15000);
}

function mapArtistRankingItem(artist) {
	return {
		name: artist?.name || "Artiste",
		popularity: artist?.popularity || 0,
		followers: artist?.followers?.total || 0,
		cover: artist?.images?.[0]?.url || ""
	};
}

function getFallbackConcertArtists() {
	const seeds = [
		String(focusTitle?.textContent || "").trim(),
		...quickCards.map((card) => String(card?.dataset?.artist || "").trim()),
		...albumCards.map((card) => String(card?.dataset?.artist || "").trim())
	].filter(Boolean);

	const unique = [];
	const seen = new Set();
	for (const name of seeds) {
		const key = name.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(name);
	}

	return unique.slice(0, 5);
}

function formatConcertDate(rawDate, rawTime) {
	if (!rawDate) {
		return "Date a confirmer";
	}
	const iso = rawTime ? `${rawDate}T${rawTime}` : rawDate;
	const dateObj = new Date(iso);
	if (Number.isNaN(dateObj.getTime())) {
		return "Date a confirmer";
	}
	return dateObj.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function mapConcertItem(eventItem, fallbackArtist) {
	if (!eventItem) {
		return null;
	}

	const localDate = eventItem?.dates?.start?.localDate || "";
	const localTime = eventItem?.dates?.start?.localTime || "";
	const venueInfo = eventItem?._embedded?.venues?.[0] || {};
	const attractions = eventItem?._embedded?.attractions || [];
	const eventArtist = attractions?.[0]?.name || fallbackArtist || "Artiste";

	const when = formatConcertDate(localDate, localTime);
	const whenMs = localDate ? new Date(localTime ? `${localDate}T${localTime}` : localDate).getTime() : Number.POSITIVE_INFINITY;
	const venue = venueInfo?.name || "Lieu non precise";
	const city = venueInfo?.city?.name || "Ville inconnue";
	const country = venueInfo?.country?.name || "";
	const rawConcertId = String(eventItem?.id || "").trim();
	const fallbackKey = [eventArtist, localDate, venue, city]
		.map((value) => String(value || "").trim().replace(/\s+/g, "_"))
		.filter(Boolean)
		.join("|")
		.slice(0, 140);
	const chatKey = rawConcertId ? `tm:${rawConcertId}` : `local:${fallbackKey || "concert"}`;

	return {
		id: String(eventItem?.id || ""),
		chatKey,
		artist: eventArtist,
		when,
		whenMs: Number.isFinite(whenMs) ? whenMs : Number.POSITIVE_INFINITY,
		venue,
		city,
		country,
		url: eventItem?.url || ""
	};
}

async function fetchConcertsForArtist(artistName) {
	if (!artistName || !TICKETMASTER_KEY) {
		return [];
	}

	const artistKey = String(artistName).trim().toLowerCase();
	const cacheKey = `WithMe-concerts-${artistKey}`;
	const cached = readJsonCache(cacheKey, CONCERTS_CACHE_TTL_MS);
	if (Array.isArray(cached) && cached.length) {
		return cached;
	}

	if (Date.now() < ticketmasterRateLimitedUntil) {
		return [];
	}

	const baseUrl = "https://app.ticketmaster.com/discovery/v2/events.json";
	const startDateTime = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
	const params = new URLSearchParams({
		apikey: TICKETMASTER_KEY,
		keyword: artistName,
		classificationName: "music",
		size: "6",
		sort: "date,asc",
		locale: "*",
		includeTBA: "no",
		includeTBD: "no",
		startDateTime
	});

	const directUrl = `${baseUrl}?${params.toString()}`;
	const proxiedUrls = [
		`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(directUrl)}`,
		`https://corsproxy.io/?${encodeURIComponent(directUrl)}`
	];

	for (const url of proxiedUrls) {
		try {
			const response = await fetch(url);
			if (!response.ok) {
				if (response.status === 429) {
					ticketmasterRateLimitedUntil = Date.now() + (60 * 1000);
					break;
				}
				continue;
			}
			const payload = await response.json();
			const normalized = typeof payload?.contents === "string"
				? JSON.parse(payload.contents)
				: payload;
			const events = normalized?._embedded?.events || [];
			if (Array.isArray(events) && events.length) {
				const mapped = events
					.map((eventItem) => mapConcertItem(eventItem, artistName))
					.filter(Boolean);
				if (mapped.length) {
					writeJsonCache(cacheKey, mapped, CONCERTS_CACHE_TTL_MS);
				}
				return mapped;
			}
		} catch (e) {
			continue;
		}
	}

	return [];
}

async function fetchRecentConcerts(topArtists) {
	const cached = readJsonCache("WithMe-concerts-recent", CONCERTS_CACHE_TTL_MS);
	if (Array.isArray(cached) && cached.length) {
		return cached;
	}

	if (!TICKETMASTER_KEY) {
		return [];
	}

	const artistsFromSpotify = Array.isArray(topArtists)
		? topArtists.map((artist) => String(artist?.name || "").trim()).filter(Boolean)
		: [];
	const artists = artistsFromSpotify.length ? artistsFromSpotify.slice(0, 2) : getFallbackConcertArtists().slice(0, 2);

	if (!artists.length) {
		return [];
	}

	const merged = [];
	for (const name of artists) {
		const events = await fetchConcertsForArtist(name);
		if (Array.isArray(events) && events.length) {
			merged.push(...events);
		}
		if (merged.length >= 8) {
			break;
		}
	}

	const unique = [];
	const seen = new Set();
	for (const concert of merged) {
		const key = concert.id || `${concert.artist}|${concert.when}|${concert.venue}|${concert.city}`;
		if (!key || seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(concert);
	}

	unique.sort((a, b) => a.whenMs - b.whenMs);
	const sliced = unique.slice(0, 6);
	if (sliced.length) {
		writeJsonCache("WithMe-concerts-recent", sliced, CONCERTS_CACHE_TTL_MS);
	}
	return sliced;
}

function renderRecentConcerts(concerts) {
	if (!concertsList) {
		return;
	}

	if (!Array.isArray(concerts) || !concerts.length) {
		concertsList.innerHTML = "<li><span>i</span><strong>Aucun concert trouve</strong><em>Essaie de relancer plus tard</em></li>";
		return;
	}

	concertsList.innerHTML = "";
	concerts.forEach((concert) => {
		const location = `${concert.venue} · ${concert.city}${concert.country ? `, ${concert.country}` : ""}`;
		const li = document.createElement("li");
		li.innerHTML = `<span>${concert.when}</span><strong>${concert.artist}</strong><em>${location}</em>`;

		const chatLink = document.createElement("a");
		chatLink.className = "detail-link";
		chatLink.href = `concert-chat.html?concertKey=${encodeURIComponent(concert.chatKey)}&artist=${encodeURIComponent(concert.artist)}`;
		chatLink.textContent = "Ouvrir le chat";
		li.appendChild(chatLink);

		if (concert.url) {
			const ticketLink = document.createElement("a");
			ticketLink.className = "detail-link";
			ticketLink.href = concert.url;
			ticketLink.target = "_blank";
			ticketLink.rel = "noopener noreferrer";
			ticketLink.textContent = "Billets";
			li.appendChild(ticketLink);
		}
		concertsList.appendChild(li);
	});
}

function renderConcertsLoadingState() {
	if (!concertsList) {
		return;
	}
	concertsList.innerHTML = "<li><span>...</span><strong>Chargement des concerts</strong><em>Recherche en cours</em></li>";
}

function renderFocusArtist(artist) {
	if (!artist || !focusCover || !focusTitle || !focusArtist || !focusListeners) {
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

function renderDmFriends(items) {
	if (!dmFriendsList || !dmFriendsMeta) {
		return;
	}

	dmFriendsList.innerHTML = "";
	const list = Array.isArray(items) ? items : [];
	dmFriendsMeta.textContent = `${list.length} ami(s)`;

	if (!list.length) {
		dmFriendsList.innerHTML = '<li class="dm-friend-empty">Ajoute des amis depuis la recherche pour commencer a DM.</li>';
		return;
	}

	for (const friend of list) {
		const id = Number(friend?.id || 0);
		if (!id) {
			continue;
		}
		const username = String(friend?.username || "Utilisateur").trim() || "Utilisateur";
		const avatarUrl = String(friend?.avatarUrl || "").trim() || PROFILE_FALLBACK_AVATAR;

		const item = document.createElement("li");
		item.className = "dm-friend-item";
		item.innerHTML = `
			<a class="dm-friend-link" href="direct-chat.html?userId=${encodeURIComponent(id)}&username=${encodeURIComponent(username)}">
				<img src="${avatarUrl}" alt="Avatar ${username}" />
				<div>
					<strong>${username}</strong>
					<small>Ouvrir la discussion</small>
				</div>
			</a>
		`;
		dmFriendsList.appendChild(item);
	}
}

async function initDmFriendsPanel() {
	if (!dmFriendsList || !dmFriendsMeta || !window.WithMeAuth?.getFriends) {
		return;
	}

	try {
		dmFriendsMeta.textContent = "Chargement...";
		const friends = await window.WithMeAuth.getFriends();
		renderDmFriends(friends);
	} catch (error) {
		dmFriendsMeta.textContent = "Indisponible";
		dmFriendsList.innerHTML = '<li class="dm-friend-empty">Impossible de charger les amis.</li>';
	}
}

function mapSidebarPlaylist(playlist) {
	if (!playlist) {
		return null;
	}

	return {
		id: playlist.id || "",
		name: playlist.name || "Playlist",
		url: playlist.external_urls?.spotify || "",
		owner: playlist.owner?.display_name || playlist.owner?.id || "",
		totalTracks: Number(playlist.tracks?.total || 0)
	};
}

function renderSidebarPlaylists(playlists) {
	if (!playlistMenuLinks.length || !Array.isArray(playlists) || !playlists.length) {
		return;
	}

	playlistMenuLinks.forEach((link, index) => {
		const playlist = playlists[index];
		if (!playlist) {
			return;
		}

		link.textContent = playlist.name;
		if (playlist.url) {
			link.href = playlist.url;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
		}

		const ownerPart = playlist.owner ? `Par ${playlist.owner}` : "";
		const totalPart = Number.isFinite(playlist.totalTracks) && playlist.totalTracks > 0
			? `${playlist.totalTracks} titres`
			: "";
		const titleParts = [ownerPart, totalPart].filter(Boolean);
		if (titleParts.length) {
			link.title = titleParts.join(" · ");
		}
	});
}

async function fetchSidebarPlaylists(token, limit = 4) {
	if (!token || !playlistMenuLinks.length) {
		return [];
	}

	const normalizedLimit = Math.min(10, Math.max(1, Number(limit) || 4));
	const listing = await spotifyGetCached(
		`/me/playlists?limit=${normalizedLimit}&offset=0`,
		token,
		`WithMe-playlists-${normalizedLimit}`,
		SPOTIFY_HOME_CACHE_TTL_MS
	);

	return (listing?.items || [])
		.slice(0, normalizedLimit)
		.map((item) => mapSidebarPlaylist(item))
		.filter(Boolean);
}

async function initSpotifyHomeData() {
	renderConcertsLoadingState();

	const token = await getValidSpotifyToken();
	if (!token) {
		const fallbackConcerts = await fetchRecentConcerts([]);
		renderRecentConcerts(fallbackConcerts);
		return;
	}

	try {
		const profile = readJsonCache("WithMe-profile", SPOTIFY_PROFILE_CACHE_TTL_MS);
		let topTracksRes = readJsonCache("WithMe-top-tracks", SPOTIFY_HOME_CACHE_TTL_MS);
		let recentRes = readJsonCache("WithMe-recent-tracks", SPOTIFY_HOME_CACHE_TTL_MS);
		let topArtistsRes = readJsonCache("WithMe-top-artists", SPOTIFY_HOME_CACHE_TTL_MS);
		const playlistsCacheKey = `WithMe-playlists-${playlistMenuLinks.length || 4}`;
		let playlistsListing = readJsonCache(playlistsCacheKey, SPOTIFY_HOME_CACHE_TTL_MS);

		if (Date.now() >= getSpotifyRateLimitedUntil()) {
			if (!topTracksRes) {
				topTracksRes = await spotifyGetCached(
					"/me/top/tracks?limit=6&time_range=short_term",
					token,
					"WithMe-top-tracks",
					SPOTIFY_HOME_CACHE_TTL_MS
				);
			}
			if (!recentRes) {
				recentRes = await spotifyGetCached(
					"/me/player/recently-played?limit=4",
					token,
					"WithMe-recent-tracks",
					SPOTIFY_HOME_CACHE_TTL_MS
				);
			}
			if (!topArtistsRes) {
				topArtistsRes = await spotifyGetCached(
					"/me/top/artists?limit=5&time_range=short_term",
					token,
					"WithMe-top-artists",
					SPOTIFY_HOME_CACHE_TTL_MS
				);
			}
			if (!playlistsListing) {
				playlistsListing = await spotifyGetCached(
					`/me/playlists?limit=${Math.min(10, Math.max(1, playlistMenuLinks.length || 4))}&offset=0`,
					token,
					playlistsCacheKey,
					SPOTIFY_HOME_CACHE_TTL_MS
				);
			}
		}

		const sidebarPlaylists = (playlistsListing?.items || [])
			.slice(0, Math.min(10, Math.max(1, playlistMenuLinks.length || 4)))
			.map((item) => mapSidebarPlaylist(item))
			.filter(Boolean);

		const displayName = profile?.display_name || profile?.id || String(getStoredValue("WithMe-display-name") || "").trim();
		if (displayName) {
			setCookie("WithMe-display-name", displayName, 60 * 60 * 24 * 365);
			setStoredValue("WithMe-display-name", displayName);
			initWelcome();
		}

		const topTracks = (topTracksRes?.items || []).map(mapTrackItem).filter(Boolean);
		const recentTracks = (recentRes?.items || []).map((item) => mapTrackItem(item?.track)).filter(Boolean);
		const topArtists = (topArtistsRes?.items || []).map(mapArtistRankingItem);
		const recentConcerts = await fetchRecentConcerts(topArtists);

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
			renderFocusArtist(topArtists[0]);
		}

		renderRecentConcerts(recentConcerts);

		renderSidebarPlaylists(sidebarPlaylists);

		const firstPlayable = recentTracks[0] || topTracks[0];
		if (firstPlayable) {
			renderPlayerTrack(firstPlayable);
		}

		// Keep player sync disabled on startup to avoid hitting extra playback endpoints.
	} catch (error) {
		if (String(error?.message || "").includes("spotify_unauthorized")) {
			clearSpotifyStoredAuth();
		}
		const fallbackConcerts = await fetchRecentConcerts([]);
		renderRecentConcerts(fallbackConcerts);
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
		setCookie("WithMe-theme", nextTheme, 60 * 60 * 24 * 365);
	});
}

(async function bootHomePage() {
	initTheme();
	initHeaderProfile();
	initDmFriendsPanel();
	await handleSpotifyOAuthCallbackOnHome();
	initWelcome();
	initSpotifyHomeData();
	startProgressLoop();
})();
