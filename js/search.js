const themeToggle = document.getElementById("themeToggle");
const searchInput = document.getElementById("searchInput");
const searchType = document.getElementById("searchType");
const searchBtn = document.getElementById("searchBtn");
const searchStatus = document.getElementById("searchStatus");
const trackResults = document.getElementById("trackResults");
const artistResults = document.getElementById("artistResults");
const userResults = document.getElementById("userResults");
const tracksSection = document.getElementById("tracksSection");
const artistsSection = document.getElementById("artistsSection");
const usersSection = document.getElementById("usersSection");

const SPOTIFY_CLIENT_ID = window.WITHME_CONFIG?.spotifyClientId || "";
const SPOTIFY_SEARCH_LIMIT_MAX = 50;
const SPOTIFY_SCROLL_BATCH_SIZE = 10;
const SCROLL_LOAD_THRESHOLD_PX = 220;

let searchSession = null;
let scrollTicking = false;

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

function getApiBaseUrl() {
	return String(window.WITHME_CONFIG?.apiBaseUrl || "").trim().replace(/\/+$/, "");
}

function apiUrl(path) {
	const base = getApiBaseUrl();
	if (!base) {
		return path;
	}
	return `${base}${path}`;
}

function normalizeArtistKey(value) {
	return String(value || "").trim().toLowerCase();
}

function cacheArtistStats(artist) {
	if (!artist?.id && !artist?.name) {
		return;
	}

	const snapshot = {
		id: String(artist.id || "").trim(),
		name: String(artist.name || "").trim(),
		followers: { total: Number(artist.followers?.total || 0) },
		popularity: Number(artist.popularity || 0),
		genres: Array.isArray(artist.genres) ? artist.genres.slice(0, 6) : [],
		images: Array.isArray(artist.images) ? artist.images.slice(0, 1) : []
	};

	try {
		const raw = localStorage.getItem("WithMe-artist-stats-v1") || "{}";
		const store = JSON.parse(raw);
		if (snapshot.id) {
			store[`id:${snapshot.id}`] = snapshot;
		}
		if (snapshot.name) {
			store[`name:${normalizeArtistKey(snapshot.name)}`] = snapshot;
		}
		localStorage.setItem("WithMe-artist-stats-v1", JSON.stringify(store));
	} catch (e) {}
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
	searchStatus.textContent = message;
	searchStatus.style.color = isError ? "#d65050" : "var(--muted)";
}

function clearResults() {
	trackResults.innerHTML = "";
	artistResults.innerHTML = "";
	userResults.innerHTML = "";
}

function msToMinSec(ms) {
	const totalSec = Math.floor((ms || 0) / 1000);
	const min = Math.floor(totalSec / 60);
	const sec = String(totalSec % 60).padStart(2, "0");
	return `${min}:${sec}`;
}

function createTrackCard(track) {
	// Support MusicBrainz fallback (coverUrl, artist string)
	const isMusicBrainz = !!track.coverUrl;
	const artists = Array.isArray(track.artists) ? track.artists.map((a) => a.name).join(", ") : (track.artist || "Artiste inconnu");
	const cover = isMusicBrainz ? track.coverUrl : (track.album?.images?.[0]?.url || "img/cover-electric.svg");
	const albumName = isMusicBrainz ? (track.album || "-") : (track.album?.name || "-");
	const card = document.createElement("article");
	card.className = "result-card";
	card.innerHTML = `
		<img src="${cover}" alt="${track.name}" />
		<div>
			<h4>${track.name}</h4>
			<p>${artists || "Artiste inconnu"}</p>
			<small>Album: ${albumName} · ${msToMinSec(track.duration_ms)}</small>
		</div>
		<a class="detail-link" href="track.html?id=${encodeURIComponent(track.id)}">Voir la fiche</a>
	`;
	return card;
}

function createArtistCard(artist) {
	// Support MusicBrainz fallback (fanart.tv)
	let cover = artist.images?.[0]?.url || "";
	if (!cover && artist.id && window.getArtistPhotoUrl) {
		cover = window.getArtistPhotoUrl(artist.id);
	}
	if (!cover) cover = "img/artist-focus.svg";
	const followers = new Intl.NumberFormat("fr-FR").format(artist.followers?.total || 0);
	const artistName = artist.name || "";
	const followersRaw = String(Number(artist.followers?.total || 0));
	const popularityRaw = String(Number(artist.popularity || 0));
	const genresRaw = (artist.genres || []).slice(0, 4).join("|");
	cacheArtistStats(artist);
	const card = document.createElement("article");
	card.className = "result-card";
	card.innerHTML = `
		<img src="${cover}" alt="${artist.name}" />
		<div>
			<h4>${artist.name}</h4>
			<p>${artist.genres?.slice(0, 2).join(", ") || "Genre non precise"}</p>
			<small>${followers} followers · Popularite ${artist.popularity || 0}</small>
		</div>
		<a class="detail-link" href="artist.html?id=${encodeURIComponent(artist.id)}&name=${encodeURIComponent(artistName)}&followers=${encodeURIComponent(followersRaw)}&popularity=${encodeURIComponent(popularityRaw)}&genres=${encodeURIComponent(genresRaw)}&image=${encodeURIComponent(cover)}">Voir la fiche</a>
	`;
	return card;
}

function createUserCard(user) {
	const username = String(user?.username || "Utilisateur").trim() || "Utilisateur";
	const email = String(user?.email || "").trim();
	const bio = String(user?.bio || "").trim();
	const avatar = user?.avatarUrl || "img/artist-focus.svg";

	const card = document.createElement("article");
	card.className = "result-card user-card";
	card.innerHTML = `
		<img src="${avatar}" alt="Profil ${username}" />
		<div>
			<h4>${username}</h4>
			<p>${email || "Email indisponible"}</p>
			<small>${bio || "Aucune bio"}</small>
		</div>
		<a class="detail-link" href="user.html?id=${encodeURIComponent(user?.id || "")}">Voir profil</a>
	`;
	return card;
}

function normalizeSpotifyLimit(limit) {
	const parsed = Number(limit);
	if (!Number.isFinite(parsed)) {
		return 20;
	}
	return Math.min(SPOTIFY_SEARCH_LIMIT_MAX, Math.max(1, Math.floor(parsed)));
}

function isSpotifyLimitError(detail) {
	const text = String(detail || "").toLowerCase();
	return text.includes("invalid limit") || text.includes("range") || text.includes("between") || text.includes("limit");
}

function createTypeState(enabled) {
	return {
		enabled,
		offset: 0,
		total: 0,
		loaded: 0,
		hasMore: enabled,
		isLoading: false
	};
}

function buildSearchSession(query, token, rawType, options) {
	const wantsTrack = rawType === "track,artist,user" || rawType === "track" || rawType === "track,artist";
	const wantsArtist = rawType === "track,artist,user" || rawType === "artist" || rawType === "track,artist";
	const wantsUser = rawType === "track,artist,user" || rawType === "user";
	const canUseSpotify = Boolean(token);

	const pageSize = normalizeSpotifyLimit(options.pageSize ?? SPOTIFY_SCROLL_BATCH_SIZE);
	return {
		query,
		token,
		pageSize,
		omitLimit: Boolean(options.omitLimit),
		hasRetriedLimit: Boolean(options.hasRetriedLimit),
		rawType,
		track: createTypeState(wantsTrack && canUseSpotify),
		artist: createTypeState(wantsArtist && canUseSpotify),
		user: createTypeState(wantsUser)
	};
}

function appendResults(type, items) {
	if (!items.length) {
		return;
	}
	if (type === "track") {
		items.forEach((track) => trackResults.appendChild(createTrackCard(track)));
		return;
	}
	if (type === "artist") {
		items.forEach((artist) => artistResults.appendChild(createArtistCard(artist)));
		return;
	}
	if (type === "user") {
		items.forEach((user) => userResults.appendChild(createUserCard(user)));
		return;
	}
	items.forEach((artist) => artistResults.appendChild(createArtistCard(artist)));
}

function updateStatusFromSession() {
	if (!searchSession) {
		return;
	}
	if (searchSession.rawType === "track") {
		setStatus(`Resultats affiches: ${searchSession.track.loaded} morceau(x).`);
		return;
	}
	if (searchSession.rawType === "artist") {
		setStatus(`Resultats affiches: ${searchSession.artist.loaded} artiste(s).`);
		return;
	}
	if (searchSession.rawType === "user") {
		setStatus(`Resultats affiches: ${searchSession.user.loaded} utilisateur(s).`);
		return;
	}
	setStatus(
		`Resultats affiches: ${searchSession.track.loaded} morceau(x), ${searchSession.artist.loaded} artiste(s), ${searchSession.user.loaded} utilisateur(s).`
	);
}

function updateEmptyState() {
	if (!searchSession) {
		return;
	}
	if (searchSession.track.enabled && searchSession.track.loaded === 0 && !searchSession.track.hasMore) {
		trackResults.innerHTML = '<p class="empty-result">Aucun morceau trouve.</p>';
	}
	if (searchSession.artist.enabled && searchSession.artist.loaded === 0 && !searchSession.artist.hasMore) {
		artistResults.innerHTML = '<p class="empty-result">Aucun artiste trouve.</p>';
	}
	if (searchSession.user.enabled && searchSession.user.loaded === 0 && !searchSession.user.hasMore) {
		userResults.innerHTML = '<p class="empty-result">Aucun utilisateur trouve.</p>';
	}
}

function isNearBottom() {
	return window.innerHeight + window.scrollY >= document.body.scrollHeight - SCROLL_LOAD_THRESHOLD_PX;
}

function updateSectionsVisibility(rawType) {
	if (tracksSection) {
		tracksSection.style.display = rawType === "artist" ? "none" : "";
	}
	if (artistsSection) {
		artistsSection.style.display = rawType === "track" ? "none" : "";
	}
	if (usersSection) {
		usersSection.style.display = rawType === "track" || rawType === "artist" ? "none" : "";
	}
}

async function fetchUserPage() {
	if (!searchSession) {
		return { items: [], total: 0 };
	}

	const typeState = searchSession.user;
	const token = window.WithMeAuth?.getStoredToken?.() || "";
	if (!token) {
		throw new Error("withme_unauthorized");
	}

	const params = new URLSearchParams({
		q: searchSession.query,
		offset: String(typeState.offset),
		limit: String(searchSession.pageSize)
	});

	const response = await fetch(apiUrl(`/api/users/search?${params.toString()}`), {
		headers: {
			Authorization: `Bearer ${token}`
		}
	});

	if (!response.ok) {
		if (response.status === 401) {
			throw new Error("withme_unauthorized");
		}
		throw new Error(`withme_error_${response.status}`);
	}

	const payload = await response.json();
	return {
		items: payload?.items || [],
		total: Number(payload?.total || 0)
	};
}

async function fetchSearchPage(type) {
	if (!searchSession) {
		return { items: [], total: 0 };
	}

	if (type === "user") {
		return fetchUserPage();
	}

	if (!searchSession.token) {
		return { items: [], total: 0 };
	}

	const typeState = searchSession[type];
	const searchParams = new URLSearchParams({
		q: searchSession.query,
		type,
		offset: String(typeState.offset)
	});

	if (!searchSession.omitLimit) {
		searchParams.set("limit", String(searchSession.pageSize));
	}

	const payload = await window.WithMeSpotify.spotifyGet(`/search?${searchParams.toString()}`, searchSession.token);
	const container = payload?.[`${type}s`];
	return {
		items: container?.items || [],
		total: Number(container?.total || 0)
	};
}

async function loadNextBatch(type) {
	if (!searchSession) {
		return;
	}

	const typeState = searchSession[type];
	if (!typeState.enabled || typeState.isLoading || !typeState.hasMore) {
		return;
	}

	typeState.isLoading = true;
	try {
		const { items, total } = await fetchSearchPage(type);
		typeState.total = total;
		typeState.offset += items.length;
		typeState.loaded += items.length;
		typeState.hasMore = typeState.offset < total && typeState.offset < 1000;

		appendResults(type, items);
		updateEmptyState();
		updateStatusFromSession();
	} finally {
		typeState.isLoading = false;
	}
}

function parseSpotifyError(message) {
	const msg = String(message || "");
	if (!msg.startsWith("spotify_error_")) {
		return null;
	}
	const parsed = msg.match(/^spotify_error_(\d+)(?::(.*))?$/);
	return {
		statusCode: Number(parsed?.[1] || 0),
		detail: parsed?.[2] || "",
		raw: msg
	};
}

async function handleSearchError(error) {
	if (String(error?.message || "") === "withme_unauthorized") {
		setStatus("Session WithMe expiree. Reconnecte-toi.", true);
		searchSession = null;
		window.WithMeAuth.redirectToLogin();
		return;
	}

	if (String(error?.message || "").includes("spotify_unauthorized")) {
		window.WithMeSpotify.clearSpotifyStoredAuth();
		setStatus("Session Spotify expiree. Reconnecte-toi.", true);
		searchSession = null;
		return;
	}

	const spotifyError = parseSpotifyError(error?.message || "");
	if (!spotifyError) {
		setStatus("Erreur pendant la recherche Spotify.", true);
		return;
	}

	if (spotifyError.statusCode === 429) {
		setStatus("Spotify limite temporairement les requetes. Patiente quelques secondes puis relance.", true);
		return;
	}

	if (spotifyError.statusCode === 400 && isSpotifyLimitError(spotifyError.detail)) {
		if (searchSession && !searchSession.hasRetriedLimit) {
			setStatus("Erreur Spotify: limite invalide. Relance automatique en mode 10 sans parametre limit.");
			await runSearch({
				hasRetriedLimit: true,
				pageSize: SPOTIFY_SCROLL_BATCH_SIZE,
				omitLimit: true
			});
			return;
		}
		setStatus(`Erreur Spotify apres relance: ${spotifyError.detail || "parametre de limite invalide"}.`, true);
		return;
	}

	setStatus(`Erreur Spotify: ${spotifyError.detail || spotifyError.raw}.`, true);
}

async function loadInitialBatches() {
	if (!searchSession) {
		return;
	}

	const tasks = [];
	if (searchSession.track.enabled) {
		tasks.push({ type: "track", promise: loadNextBatch("track") });
	}
	if (searchSession.artist.enabled) {
		tasks.push({ type: "artist", promise: loadNextBatch("artist") });
	}
	if (searchSession.user.enabled) {
		tasks.push({ type: "user", promise: loadNextBatch("user") });
	}

	const settled = await Promise.allSettled(tasks.map((task) => task.promise));
	for (let i = 0; i < settled.length; i += 1) {
		if (settled[i].status === "rejected") {
			await handleSearchError(settled[i].reason);
		}
	}
}

async function loadMoreIfNearBottom() {
	let safety = 0;
	while (searchSession && isNearBottom() && safety < 8) {
		safety += 1;
		const tasks = [];
		if (searchSession.track.enabled && searchSession.track.hasMore) {
			tasks.push(loadNextBatch("track"));
		}
		if (searchSession.artist.enabled && searchSession.artist.hasMore) {
			tasks.push(loadNextBatch("artist"));
		}
		if (searchSession.user.enabled && searchSession.user.hasMore) {
			tasks.push(loadNextBatch("user"));
		}

		if (!tasks.length) {
			break;
		}

		const settled = await Promise.allSettled(tasks);
		for (const result of settled) {
			if (result.status === "rejected") {
				await handleSearchError(result.reason);
			}
		}
	}
}

async function runSearch(options = {}) {
	const query = searchInput.value.trim();
	if (!query) {
		setStatus("Ecris un artiste ou un morceau.", true);
		return;
	}

	if (!SPOTIFY_CLIENT_ID) {
		if (searchType.value !== "user") {
			setStatus("spotifyClientId manquant dans spotify-config.js", true);
			return;
		}
	}

	const rawType = searchType.value;
	const wantsSpotify = rawType === "track" || rawType === "artist" || rawType === "track,artist";
	const wantsUsers = rawType === "user" || rawType === "track,artist,user";

	let token = "";
	if (wantsSpotify && SPOTIFY_CLIENT_ID) {
		token = await window.WithMeSpotify.getValidSpotifyToken(SPOTIFY_CLIENT_ID);
	}

	if (wantsSpotify && !token && !wantsUsers) {
		setStatus("Connecte-toi d'abord sur la page login Spotify.", true);
		return;
	}

	if (wantsSpotify && !token && wantsUsers) {
		setStatus("Spotify non connecte: affichage des utilisateurs uniquement.");
	} else {
		setStatus("Recherche en cours...");
	}
	clearResults();

	updateSectionsVisibility(rawType);
	searchSession = buildSearchSession(query, token, rawType, options);

	try {
		await loadInitialBatches();
		await loadMoreIfNearBottom();
	} catch (error) {
		await handleSearchError(error);
	}
}

function onScrollLoadMore() {
	if (scrollTicking) {
		return;
	}
	scrollTicking = true;
	window.requestAnimationFrame(async () => {
		scrollTicking = false;
		if (!searchSession || !isNearBottom()) {
			return;
		}
		await loadMoreIfNearBottom();
	});
}

if (themeToggle) {
	themeToggle.addEventListener("click", () => {
		const isDark = document.body.classList.contains("dark-mode");
		const nextTheme = isDark ? "light" : "dark";
		applyTheme(nextTheme);
		setCookie("WithMe-theme", nextTheme, 60 * 60 * 24 * 365);
	});
}

searchBtn.addEventListener("click", runSearch);
searchInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		event.preventDefault();
		runSearch();
	}
});
window.addEventListener("scroll", onScrollLoadMore, { passive: true });

initTheme();
