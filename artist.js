const themeToggle = document.getElementById("themeToggle");
const detailStatus = document.getElementById("detailStatus");
const artistDetail = document.getElementById("artistDetail");
const concertList = document.getElementById("concertList");

const SPOTIFY_CLIENT_ID = window.SPOTEUR_CONFIG?.spotifyClientId || "";

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
	const storedTheme = getCookie("spoteur-theme");
	const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
	applyTheme(storedTheme || (prefersDark ? "dark" : "light"));
}

function setStatus(message, isError = false) {
	detailStatus.textContent = message;
	detailStatus.style.color = isError ? "#d65050" : "var(--muted)";
}

function getArtistId() {
	const params = new URLSearchParams(window.location.search);
	return params.get("id") || "";
}

function getArtistNameHint() {
	const params = new URLSearchParams(window.location.search);
	return (params.get("name") || "").trim();
}

function renderArtist(artist, topTracks) {
	const cover = artist.images?.[0]?.url || "img/artist-focus.svg";
	const followersValue = Number(artist.followers?.total || 0);
	const followers = followersValue > 0
		? new Intl.NumberFormat("fr-FR").format(followersValue)
		: "Non fourni par Spotify";
	const popularityValue = Number(artist.popularity || 0);
	const popularity = popularityValue > 0 ? String(popularityValue) : "Non fourni par Spotify";
	const genres = artist.genres?.join(", ") || "Non fourni par Spotify";
	const tracksHtml = (topTracks || []).slice(0, 5).map((track) => {
		const artists = (track.artists || []).map((a) => a.name).join(", ");
		return `<li><a class=\"inline-link\" href=\"track.html?id=${encodeURIComponent(track.id)}\">${track.name}</a> · ${artists}</li>`;
	}).join("");
	const hasMissingStats = followersValue <= 0 || popularityValue <= 0 || !(artist.genres?.length);

	artistDetail.innerHTML = `
		<img class="detail-cover" src="${cover}" alt="${artist.name}" />
		<div class="detail-body">
			<h2>${artist.name}</h2>
			<p><strong>Followers:</strong> ${followers}</p>
			<p><strong>Popularite:</strong> ${popularity}</p>
			<p><strong>Genres:</strong> ${genres}</p>
			${hasMissingStats ? "<p><small>Note: Spotify peut masquer certaines stats artistes (champs deprecies).</small></p>" : ""}
			<h3 class="list-title">Top morceaux</h3>
			<ul class="simple-list">${tracksHtml || "<li>Aucun top morceau disponible.</li>"}</ul>
			<h3 class="list-title">Albums</h3>
			<ul id="albumsList" class="simple-list"><li>Chargement des albums...</li></ul>
		</div>
	`;
}

function renderAlbums(albums) {
	const albumsList = document.getElementById("albumsList");
	if (!albumsList) {
		return;
	}

	const unique = [];
	const seen = new Set();
	(albums || []).forEach((album) => {
		const key = `${(album?.name || "").toLowerCase()}::${album?.release_date || ""}`;
		if (!key || seen.has(key)) {
			return;
		}
		seen.add(key);
		unique.push(album);
	});

	if (!unique.length) {
		albumsList.innerHTML = "<li>Aucun album disponible.</li>";
		return;
	}

	albumsList.innerHTML = unique.slice(0, 10).map((album) => {
		const year = String(album?.release_date || "").slice(0, 4) || "-";
		const link = album?.external_urls?.spotify || "";
		if (link) {
			return `<li><a class=\"inline-link\" href=\"${link}\" target=\"_blank\" rel=\"noopener noreferrer\">${album?.name || "Album"}</a> · ${year}</li>`;
		}
		return `<li>${album?.name || "Album"} · ${year}</li>`;
	}).join("");
}

async function fetchConcerts(artistName) {
	concertList.innerHTML = "";
	const eventApiKey = window.SPOTEUR_CONFIG?.eventAPIkey || 'spoteur_live';
	const directUrl = `https://rest.bandsintown.com/artists/${encodeURIComponent(artistName)}/events?app_id=${eventApiKey}&date=upcoming`;
	const proxiedUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`;
	const urlsToTry = [proxiedUrl, directUrl];

	try {
		let events = null;
		for (const url of urlsToTry) {
			try {
				const response = await fetch(url);
				if (!response.ok) {
					continue;
				}
				const payload = await response.json();
				if (Array.isArray(payload)) {
					events = payload;
					break;
				}
			} catch (e) {
				continue;
			}
		}

		if (!Array.isArray(events)) {
			throw new Error("concert_error");
		}

		if (!Array.isArray(events) || !events.length) {
			concertList.innerHTML = "<li>Aucune date de concert annoncee.</li>";
			return;
		}

		events.slice(0, 8).forEach((eventItem) => {
			const li = document.createElement("li");
			const d = new Date(eventItem.datetime);
			const venue = eventItem?.venue?.name || "Lieu non precise";
			const city = eventItem?.venue?.city || "Ville inconnue";
			const country = eventItem?.venue?.country || "";
			li.innerHTML = `<strong>${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</strong><span>${venue} · ${city}${country ? `, ${country}` : ""}</span>`;
			concertList.appendChild(li);
		});
	} catch (error) {
		concertList.innerHTML = `<li>Concerts indisponibles pour le moment. <a class=\"inline-link\" href=\"https://www.bandsintown.com/a/${encodeURIComponent(artistName)}\" target=\"_blank\" rel=\"noopener noreferrer\">Voir sur Bandsintown</a>.</li>`;
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

async function fetchArtistTopTracksWithFallback(id, token) {
	const markets = ["", "FR", "US"];
	let lastError = null;

	for (const market of markets) {
		try {
			const marketQuery = market ? `?market=${encodeURIComponent(market)}` : "";
			const payload = await window.spoteurSpotify.spotifyGet(
				`/artists/${encodeURIComponent(id)}/top-tracks${marketQuery}`,
				token
			);
			return payload?.tracks || [];
		} catch (error) {
			lastError = error;
			const spotifyError = parseSpotifyError(error?.message || "");
			if (spotifyError?.statusCode && ![400, 403, 404].includes(spotifyError.statusCode)) {
				throw error;
			}
		}
	}

	if (lastError) {
		throw lastError;
	}
	return [];
}

async function fetchArtistAlbumsWithFallback(id, token) {
	const markets = ["", "FR", "US"];
	let lastError = null;

	for (const market of markets) {
		try {
			const marketQuery = market ? `&market=${encodeURIComponent(market)}` : "";
			const payload = await window.spoteurSpotify.spotifyGet(
				`/artists/${encodeURIComponent(id)}/albums?include_groups=album,single&limit=10${marketQuery}`,
				token
			);
			return payload?.items || [];
		} catch (error) {
			lastError = error;
			const spotifyError = parseSpotifyError(error?.message || "");
			if (spotifyError?.statusCode && ![400, 404].includes(spotifyError.statusCode)) {
				throw error;
			}
		}
	}

	if (lastError) {
		throw lastError;
	}
	return [];
}

async function fetchArtistBySeveralEndpoint(id, token) {
	const payload = await window.spoteurSpotify.spotifyGet(`/artists?ids=${encodeURIComponent(id)}`, token);
	const artists = payload?.artists || [];
	return artists[0] || null;
}

function needsArtistEnrichment(artist) {
	if (!artist) {
		return true;
	}
	const followers = Number(artist.followers?.total || 0);
	const popularity = Number(artist.popularity || 0);
	const hasGenres = Array.isArray(artist.genres) && artist.genres.length > 0;
	return followers === 0 && popularity === 0 && !hasGenres;
}

function isArtistStatsMissing(artist) {
	if (!artist) {
		return true;
	}
	const followers = Number(artist.followers?.total || 0);
	const popularity = Number(artist.popularity || 0);
	return followers === 0 || popularity === 0;
}

function normalizeName(value) {
	return String(value || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.trim();
}

function mergeArtistStats(baseArtist, candidate) {
	if (!baseArtist || !candidate) {
		return baseArtist;
	}

	const merged = { ...baseArtist };
	const baseFollowers = Number(baseArtist.followers?.total || 0);
	const candidateFollowers = Number(candidate.followers?.total || 0);
	if (baseFollowers <= 0 && candidateFollowers > 0) {
		merged.followers = { ...(baseArtist.followers || {}), total: candidateFollowers };
	}

	const basePopularity = Number(baseArtist.popularity || 0);
	const candidatePopularity = Number(candidate.popularity || 0);
	if (basePopularity <= 0 && candidatePopularity > 0) {
		merged.popularity = candidatePopularity;
	}

	const baseGenres = Array.isArray(baseArtist.genres) ? baseArtist.genres : [];
	const candidateGenres = Array.isArray(candidate.genres) ? candidate.genres : [];
	if (!baseGenres.length && candidateGenres.length) {
		merged.genres = candidateGenres;
	}

	if ((!baseArtist.images || !baseArtist.images.length) && candidate.images?.length) {
		merged.images = candidate.images;
	}

	return merged;
}

function scoreArtistCandidate(candidate, targetNameNorm, preferredId = "") {
	if (!candidate) {
		return -1;
	}
	let score = 0;
	const candidateNameNorm = normalizeName(candidate.name || "");
	if (candidateNameNorm === targetNameNorm) {
		score += 200;
	} else if (candidateNameNorm.includes(targetNameNorm) || targetNameNorm.includes(candidateNameNorm)) {
		score += 120;
	}
	if (preferredId && candidate.id === preferredId) {
		score += 160;
	}
	score += Math.min(120, Math.floor(Number(candidate.followers?.total || 0) / 50000));
	score += Math.min(100, Number(candidate.popularity || 0));
	if (Array.isArray(candidate.genres) && candidate.genres.length) {
		score += 25;
	}
	return score;
}

async function fetchBestArtistCandidate(targetName, token, preferredId = "") {
	const queryName = String(targetName || "").trim();
	if (!queryName) {
		return null;
	}

	const searchPayload = await window.spoteurSpotify.spotifyGet(
		`/search?q=${encodeURIComponent(queryName)}&type=artist&limit=10`,
		token
	);
	const candidates = searchPayload?.artists?.items || [];
	if (!candidates.length) {
		return null;
	}

	const ids = candidates.map((item) => item?.id).filter(Boolean).slice(0, 10);
	let detailedCandidates = candidates;
	if (ids.length) {
		try {
			const bulkPayload = await window.spoteurSpotify.spotifyGet(
				`/artists?ids=${encodeURIComponent(ids.join(","))}`,
				token
			);
			const bulkArtists = (bulkPayload?.artists || []).filter(Boolean);
			if (bulkArtists.length) {
				detailedCandidates = bulkArtists;
			}
		} catch (e) {}
	}

	const targetNorm = normalizeName(queryName);
	const best = detailedCandidates
		.map((candidate) => ({ candidate, score: scoreArtistCandidate(candidate, targetNorm, preferredId) }))
		.sort((a, b) => b.score - a.score)[0]?.candidate;

	return best || null;
}

function promoteArtistWithBestCandidate(currentArtist, bestCandidate) {
	if (!currentArtist && bestCandidate) {
		return bestCandidate;
	}
	if (!bestCandidate) {
		return currentArtist;
	}
	const merged = mergeArtistStats(currentArtist, bestCandidate);

	const currentFollowers = Number(currentArtist?.followers?.total || 0);
	const currentPopularity = Number(currentArtist?.popularity || 0);
	const bestFollowers = Number(bestCandidate?.followers?.total || 0);
	const bestPopularity = Number(bestCandidate?.popularity || 0);

	if (bestFollowers > currentFollowers || bestPopularity > currentPopularity) {
		return {
			...merged,
			id: bestCandidate.id || merged.id,
			name: bestCandidate.name || merged.name,
			external_urls: bestCandidate.external_urls || merged.external_urls,
			uri: bestCandidate.uri || merged.uri
		};
	}

	return merged;
}

async function enrichArtistDataByName(artist, token) {
	if (!artist?.name) {
		return artist;
	}

	const payload = await window.spoteurSpotify.spotifyGet(
		`/search?q=${encodeURIComponent(artist.name)}&type=artist&limit=5`,
		token
	);
	const candidates = payload?.artists?.items || [];
	if (!candidates.length) {
		return artist;
	}

	const best = candidates.sort((a, b) => (b?.popularity || 0) - (a?.popularity || 0))[0];
	if (!best?.id) {
		return artist;
	}

	const full = await window.spoteurSpotify.spotifyGet(`/artists/${encodeURIComponent(best.id)}`, token);
	return full || artist;
}

async function enrichArtistStatsBySearch(artist, token, nameHint = "") {
	const targetName = (artist?.name || nameHint || "").trim();
	if (!targetName) {
		return artist;
	}

	const payload = await window.spoteurSpotify.spotifyGet(
		`/search?q=${encodeURIComponent(targetName)}&type=artist&limit=10`,
		token
	);
	const candidates = payload?.artists?.items || [];
	if (!candidates.length) {
		return artist;
	}

	const targetNorm = normalizeName(targetName);
	const exactCandidates = candidates.filter((item) => normalizeName(item?.name) === targetNorm);
	const pool = exactCandidates.length ? exactCandidates : candidates;
	pool.sort((a, b) => {
		const followersA = Number(a?.followers?.total || 0);
		const followersB = Number(b?.followers?.total || 0);
		if (followersA !== followersB) {
			return followersB - followersA;
		}
		return Number(b?.popularity || 0) - Number(a?.popularity || 0);
	});

	return mergeArtistStats(artist, pool[0]);
}

async function fetchTopTracksBySearchFallback(artist, token) {
	const artistName = (artist?.name || "").trim();
	if (!artistName) {
		return [];
	}

	const payload = await window.spoteurSpotify.spotifyGet(
		`/search?q=${encodeURIComponent(`artist:${artistName}`)}&type=track&limit=10`,
		token
	);
	const items = payload?.tracks?.items || [];
	const artistId = artist?.id || "";
	const artistNameNorm = normalizeName(artistName);

	return items.filter((track) => {
		const trackArtists = track?.artists || [];
		return trackArtists.some((a) => {
			if (artistId && a?.id === artistId) {
				return true;
			}
			return normalizeName(a?.name) === artistNameNorm;
		});
	});
}

async function initArtistPage() {
	const id = getArtistId();
	const nameHint = getArtistNameHint();
	if (!id) {
		setStatus("Aucun id artiste fourni.", true);
		return;
	}

	if (!SPOTIFY_CLIENT_ID) {
		setStatus("spotifyClientId manquant dans spotify-config.js", true);
		return;
	}

	const token = await window.spoteurSpotify.getValidSpotifyToken(SPOTIFY_CLIENT_ID);
	if (!token) {
		setStatus("Connecte-toi d'abord via login Spotify.", true);
		return;
	}

	try {
		const settled = await Promise.allSettled([
			window.spoteurSpotify.spotifyGet(`/artists/${encodeURIComponent(id)}`, token),
			fetchArtistTopTracksWithFallback(id, token)
		]);

		let initialArtist = settled[0].status === "fulfilled" ? settled[0].value : null;
		if (!initialArtist) {
			initialArtist = await fetchArtistBySeveralEndpoint(id, token);
		}
		if (!initialArtist) {
			throw settled[0].status === "rejected" ? settled[0].reason : new Error("spotify_error_404");
		}

		let artist = initialArtist;
		if (needsArtistEnrichment(artist)) {
			try {
				artist = await enrichArtistDataByName(artist, token);
			} catch (e) {}
		}
		if (needsArtistEnrichment(artist) && nameHint) {
			try {
				artist = await enrichArtistDataByName({ name: nameHint }, token);
			} catch (e) {}
		}
		if (isArtistStatsMissing(artist)) {
			try {
				artist = await enrichArtistStatsBySearch(artist, token, nameHint);
			} catch (e) {}
		}

		const primaryNameForStats = artist?.name || nameHint;
		if (primaryNameForStats) {
			try {
				const bestCandidate = await fetchBestArtistCandidate(primaryNameForStats, token, artist?.id || id);
				artist = promoteArtistWithBestCandidate(artist, bestCandidate);
			} catch (e) {}
		}
		let topTracks = settled[1].status === "fulfilled" ? settled[1].value : [];
		let topTracksRecovered = false;

		if ((artist?.id || "") !== (initialArtist?.id || "") && !topTracks.length) {
			try {
				topTracks = await fetchArtistTopTracksWithFallback(artist.id, token);
				topTracksRecovered = topTracks.length > 0;
			} catch (e) {}
		}
		if (!topTracks.length) {
			try {
				topTracks = await fetchTopTracksBySearchFallback(artist, token);
				topTracksRecovered = topTracks.length > 0;
			} catch (e) {}
		}

		renderArtist(artist, topTracks);

		try {
			const albums = await fetchArtistAlbumsWithFallback(artist.id || id, token);
			renderAlbums(albums);
		} catch (e) {
			renderAlbums([]);
		}

		await fetchConcerts(artist.name);

		if (settled[1].status === "rejected" && !topTracksRecovered && !topTracks.length) {
			setStatus("Artiste charge. Top morceaux indisponibles pour le moment.", true);
			return;
		}

		if (isArtistStatsMissing(artist)) {
			setStatus("Artiste charge. Certaines stats ne sont pas fournies par Spotify sur cet endpoint.");
			return;
		}

		setStatus("Artiste charge.");
	} catch (error) {
		if (String(error.message).includes("spotify_unauthorized")) {
			window.spoteurSpotify.clearSpotifyStoredAuth();
			setStatus("Session Spotify expiree. Reconnecte-toi.", true);
			return;
		}

		const spotifyError = parseSpotifyError(error?.message || "");
		if (spotifyError?.statusCode === 429) {
			setStatus("Spotify limite temporairement les requetes. Reessaie dans quelques secondes.", true);
			return;
		}
		if (spotifyError?.statusCode === 404) {
			setStatus("Artiste introuvable sur Spotify.", true);
			return;
		}

		setStatus("Impossible de charger cet artiste.", true);
	}
}

if (themeToggle) {
	themeToggle.addEventListener("click", () => {
		const isDark = document.body.classList.contains("dark-mode");
		const nextTheme = isDark ? "light" : "dark";
		applyTheme(nextTheme);
		setCookie("spoteur-theme", nextTheme, 60 * 60 * 24 * 365);
	});
}

initTheme();
initArtistPage();
