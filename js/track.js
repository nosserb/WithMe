const themeToggle = document.getElementById("themeToggle");
const detailStatus = document.getElementById("detailStatus");
const trackDetail = document.getElementById("trackDetail");

const SPOTIFY_CLIENT_ID = window.WITHME_CONFIG?.spotifyClientId || "";

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
	detailStatus.textContent = message;
	detailStatus.style.color = isError ? "#d65050" : "var(--muted)";
}

function msToMinSec(ms) {
	const totalSec = Math.floor((ms || 0) / 1000);
	const min = Math.floor(totalSec / 60);
	const sec = String(totalSec % 60).padStart(2, "0");
	return `${min}:${sec}`;
}

function getTrackId() {
	const params = new URLSearchParams(window.location.search);
	return params.get("id") || "";
}

function renderTrack(track) {
	const cover = track.album?.images?.[0]?.url || "img/cover-electric.svg";
	const artists = (track.artists || []).map((a) => `<a class="inline-link" href="/html/artist.html?id=${encodeURIComponent(a.id)}&name=${encodeURIComponent(a.name || "")}">${a.name}</a>`).join(", ");
	const album = track.album?.name || "-";
	const releaseDate = track.album?.release_date || "-";
	const popularity = track.popularity ?? "-";
	const preview = track.preview_url ? `<audio controls src="${track.preview_url}"></audio>` : "<p class=\"muted\">Aucun extrait audio disponible.</p>";

	trackDetail.innerHTML = `
		<img class="detail-cover" src="${cover}" alt="${track.name}" />
		<div class="detail-body">
			<h2>${track.name}</h2>
			<p><strong>Artiste(s):</strong> ${artists || "-"}</p>
			<p><strong>Album:</strong> ${album}</p>
			<p><strong>Date de sortie:</strong> ${releaseDate}</p>
			<p><strong>Duree:</strong> ${msToMinSec(track.duration_ms)}</p>
			<p><strong>Popularite:</strong> ${popularity}</p>
			<div class="audio-wrap">${preview}</div>
		</div>
	`;
}

async function initTrackPage() {
	const id = getTrackId();
	if (!id) {
		setStatus("Aucun id de morceau fourni.", true);
		return;
	}

	if (!SPOTIFY_CLIENT_ID) {
		setStatus("spotifyClientId manquant dans spotify-config.js", true);
		return;
	}

	const token = await window.WithMeSpotify.getValidSpotifyToken(SPOTIFY_CLIENT_ID);
	if (!token) {
		setStatus("Connecte-toi d'abord via login Spotify.", true);
		return;
	}

	try {
		const track = await window.WithMeSpotify.spotifyGet(`/tracks/${encodeURIComponent(id)}`, token);
		renderTrack(track);
		setStatus("Morceau charge.");
	} catch (error) {
		if (String(error.message).includes("spotify_unauthorized")) {
			window.WithMeSpotify.clearSpotifyStoredAuth();
			setStatus("Session Spotify expiree. Reconnecte-toi.", true);
			return;
		}
		setStatus("Impossible de charger ce morceau.", true);
	}
}

if (themeToggle) {
	themeToggle.addEventListener("click", () => {
		const isDark = document.body.classList.contains("dark-mode");
		const nextTheme = isDark ? "light" : "dark";
		applyTheme(nextTheme);
		setCookie("WithMe-theme", nextTheme, 60 * 60 * 24 * 365);
	});
}

initTheme();
initTrackPage();
