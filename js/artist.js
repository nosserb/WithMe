const themeToggle = document.getElementById("themeToggle");
const detailStatus = document.getElementById("detailStatus");
const artistDetail = document.getElementById("artistDetail");
const concertList = document.getElementById("concertList");

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

function getArtistId() {
	const params = new URLSearchParams(window.location.search);
	return params.get("id") || "";
}

function getArtistNameHint() {
	const params = new URLSearchParams(window.location.search);
	return (params.get("name") || "").trim();
}

function normalizeArtistKey(value) {
	return String(value || "").trim().toLowerCase();
}

function getCachedArtistSeed(id, nameHint = "") {
	const normalizedName = normalizeArtistKey(nameHint);
	if (!id && !normalizedName) {
		return null;
	}

	try {
		const raw = localStorage.getItem("WithMe-artist-stats-v1") || "{}";
		const store = JSON.parse(raw);
		const byId = id ? store[`id:${id}`] : null;
		const byName = normalizedName ? store[`name:${normalizedName}`] : null;
		return byId || byName || null;
	} catch (e) {
		return null;
	}
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

function getArtistSeedFromQuery() {
	const params = new URLSearchParams(window.location.search);
	const id = (params.get("id") || "").trim();
	const name = (params.get("name") || "").trim();
	const followers = Number(params.get("followers") || "0");
	const popularity = Number(params.get("popularity") || "0");
	const genresRaw = (params.get("genres") || "").trim();
	const image = (params.get("image") || "").trim();
	const genres = genresRaw ? genresRaw.split("|").map((g) => g.trim()).filter(Boolean) : [];

	if (!id && !name) {
		return null;
	}

	return {
		id: id || "",
		name: name || "Artiste",
		followers: { total: Number.isFinite(followers) ? Math.max(0, followers) : 0 },
		popularity: Number.isFinite(popularity) ? Math.max(0, popularity) : 0,
		genres,
		images: image ? [{ url: image }] : []
	};
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
	// Récupère la photo d'artiste pour l'affichage concert
	let artistPhoto = "img/artist-focus.svg";
	if (window.getArtistPhotoUrl && getArtistId()) {
		artistPhoto = window.getArtistPhotoUrl(getArtistId());
	}
	const ticketmasterKey = (
		window.WITHME_CONFIG?.TicketmasterKey
		|| window.WITHME_CONFIG?.ticketmasterKey
		|| window.WITHME_CONFIG?.ticketmasterApiKey
		|| ""
	).trim();

	if (!artistName) {
		concertList.innerHTML = "<li>Nom d'artiste manquant pour rechercher des concerts.</li>";
		return;
	}

	if (!ticketmasterKey) {
		concertList.innerHTML = "<li>Cle Ticketmaster manquante dans spotify-config.js.</li>";
		return;
	}

	const baseUrl = "https://app.ticketmaster.com/discovery/v2/events.json";
	const startDateTime = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
	const params = new URLSearchParams({
		apikey: ticketmasterKey,
		keyword: artistName,
		classificationName: "music",
		size: "8",
		sort: "date,asc",
		locale: "*",
		includeTBA: "no",
		includeTBD: "no",
		startDateTime
	});

	const directUrl = `${baseUrl}?${params.toString()}`;
	const proxiedUrls = [
		`https://corsproxy.io/?${encodeURIComponent(directUrl)}`,
		`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(directUrl)}`
	];

	try {
		let events = null;
		for (const url of proxiedUrls) {
			try {
				const response = await fetch(url);
				if (!response.ok) {
					if (response.status === 401) {
						throw new Error("ticketmaster_invalid_key");
					}
					continue;
				}
				const payload = await response.json();
				const normalizedPayload = typeof payload?.contents === "string"
					? JSON.parse(payload.contents)
					: payload;
				const eventItems = normalizedPayload?._embedded?.events;
				if (Array.isArray(eventItems)) {
					events = eventItems;
					break;
				}
			} catch (e) {
				if (String(e?.message || "") === "ticketmaster_invalid_key") {
					throw e;
				}
				continue;
			}
		}

		if (!Array.isArray(events)) {
			throw new Error("concert_error");
		}

		const artistNameNorm = normalizeName(artistName);
		const filteredEvents = events.filter((eventItem) => {
			const attractions = eventItem?._embedded?.attractions || [];
			if (!attractions.length) {
				return true;
			}
			return attractions.some((attraction) => {
				const attractionNorm = normalizeName(attraction?.name || "");
				return attractionNorm === artistNameNorm
					|| attractionNorm.includes(artistNameNorm)
					|| artistNameNorm.includes(attractionNorm);
			});
		});

		const listToRender = filteredEvents.length ? filteredEvents : events;
		if (!listToRender.length) {
			concertList.innerHTML = "<li>Aucune date de concert annoncee.</li>";
			return;
		}

		listToRender.slice(0, 8).forEach((eventItem) => {
			const li = document.createElement("li");
			const venueInfo = eventItem?._embedded?.venues?.[0] || {};
			const eventId = String(eventItem?.id || "").trim();
			const localDate = eventItem?.dates?.start?.localDate || "";
			const localTime = eventItem?.dates?.start?.localTime || "";
			const rawDate = localDate ? `${localDate}${localTime ? `T${localTime}` : ""}` : "";
			const d = rawDate ? new Date(rawDate) : null;
			const formattedDate = d && !Number.isNaN(d.getTime())
				? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
				: "Date a confirmer";
			const venue = venueInfo?.name || "Lieu non precise";
			const city = venueInfo?.city?.name || "Ville inconnue";
			const country = venueInfo?.country?.name || "";
			const ticketUrl = eventItem?.url || "";
			const fallbackKey = [artistName, localDate, venue, city]
				.map((value) => String(value || "").trim().replace(/\s+/g, "_"))
				.filter(Boolean)
				.join("|")
				.slice(0, 140);
			const chatKey = eventId ? `tm:${eventId}` : `local:${fallbackKey || "concert"}`;
			const chatUrl = `concert-chat.html?concertKey=${encodeURIComponent(chatKey)}&artist=${encodeURIComponent(artistName || "Artiste")}`;
			li.innerHTML = `<img src="${artistPhoto}" alt="${artistName}" style="width:32px;height:32px;border-radius:50%;vertical-align:middle;margin-right:8px;object-fit:cover;" /> <strong>${formattedDate}</strong><span>${venue} · ${city}${country ? `, ${country}` : ""}</span> <a class="inline-link" href="${chatUrl}">Ouvrir le chat</a>${ticketUrl ? ` <a class="inline-link" href="${ticketUrl}" target="_blank" rel="noopener noreferrer">Billets</a>` : ""}`;
			concertList.appendChild(li);
		});
	} catch (error) {
		if (String(error?.message || "") === "ticketmaster_invalid_key") {
			concertList.innerHTML = "<li>La cle Ticketmaster est invalide. Verifie la valeur dans spotify-config.js.</li>";
			return;
		}
		concertList.innerHTML = "<li>Concerts Ticketmaster indisponibles pour le moment.</li>";
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

function isSpotifyForbiddenError(error) {
	const spotifyError = parseSpotifyError(error?.message || "");
	return spotifyError?.statusCode === 403;
}

async function fetchArtistTopTracksWithFallback(id, token) {
	const markets = ["", "FR", "US"];
	let lastError = null;

	for (const market of markets) {
		try {
			const marketQuery = market ? `?market=${encodeURIComponent(market)}` : "";
			const payload = await window.WithMeSpotify.spotifyGet(
				`/artists/${encodeURIComponent(id)}/top-tracks${marketQuery}`,
				token
			);
			return payload?.tracks || [];
		} catch (error) {
			lastError = error;
			const spotifyError = parseSpotifyError(error?.message || "");
			if (spotifyError?.statusCode === 403) {
				return [];
			}
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
			const payload = await window.WithMeSpotify.spotifyGet(
				`/artists/${encodeURIComponent(id)}/albums?include_groups=album,single&limit=10${marketQuery}`,
				token
			);
			return payload?.items || [];
		} catch (error) {
			lastError = error;
			const spotifyError = parseSpotifyError(error?.message || "");
			if (spotifyError?.statusCode === 403) {
				return [];
			}
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
	const payload = await window.WithMeSpotify.spotifyGet(`/artists?ids=${encodeURIComponent(id)}`, token);
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

	const searchPayload = await window.WithMeSpotify.spotifyGet(
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
			const bulkPayload = await window.WithMeSpotify.spotifyGet(
				`/artists?ids=${encodeURIComponent(ids.join(","))}`,
				token
			);
			const bulkArtists = (bulkPayload?.artists || []).filter(Boolean);
			if (bulkArtists.length) {
				detailedCandidates = bulkArtists;
			}
		} catch (e) {
			if (isSpotifyForbiddenError(e)) {
				detailedCandidates = candidates;
			}
		}
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

	const payload = await window.WithMeSpotify.spotifyGet(
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

	const full = await window.WithMeSpotify.spotifyGet(`/artists/${encodeURIComponent(best.id)}`, token);
	return full || artist;
}

async function enrichArtistStatsBySearch(artist, token, nameHint = "", preferredId = "") {
	const targetName = (artist?.name || nameHint || "").trim();
	if (!targetName) {
		return artist;
	}

	const payload = await window.WithMeSpotify.spotifyGet(
		`/search?q=${encodeURIComponent(targetName)}&type=artist&limit=10`,
		token
	);
	const candidates = payload?.artists?.items || [];
	if (!candidates.length) {
		return artist;
	}

	if (preferredId) {
		const exactById = candidates.find((item) => item?.id === preferredId);
		if (exactById) {
			return mergeArtistStats(artist, exactById);
		}
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

	const payload = await window.WithMeSpotify.spotifyGet(
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
	const artistSeed = getArtistSeedFromQuery();
	const artistCacheSeed = getCachedArtistSeed(id, nameHint);
	if (!id && !nameHint) {
		setStatus("Aucun id ou nom artiste fourni.", true);
		return;
	}

	let usedFallback = false;
	let token = null;
	if (!SPOTIFY_CLIENT_ID || !window.WithMeSpotify || !window.WithMeSpotify.getValidSpotifyToken) {
		usedFallback = true;
	}
	if (!usedFallback) {
		token = await window.WithMeSpotify.getValidSpotifyToken(SPOTIFY_CLIENT_ID);
		if (!token) usedFallback = true;
	}

	if (!usedFallback) {
		try {
			const settled = await Promise.allSettled([
				window.WithMeSpotify.spotifyGet(`/artists/${encodeURIComponent(id)}`, token),
				fetchArtistTopTracksWithFallback(id, token)
			]);

			let initialArtist = settled[0].status === "fulfilled" ? settled[0].value : null;
			const artistRequestForbidden = settled[0].status === "rejected" && isSpotifyForbiddenError(settled[0].reason);
			if (!initialArtist && !artistRequestForbidden) {
				initialArtist = await fetchArtistBySeveralEndpoint(id, token);
			}
			if (!initialArtist && artistSeed) {
				initialArtist = artistSeed;
			}
			if (!initialArtist && artistCacheSeed) {
				initialArtist = artistCacheSeed;
			}
			if (!initialArtist) {
				if (artistRequestForbidden) {
					throw settled[0].reason;
				}
				throw settled[0].status === "rejected" ? settled[0].reason : new Error("spotify_error_404");
			}

			if (artistSeed) {
				initialArtist = mergeArtistStats(initialArtist, artistSeed);
			}
			if (artistCacheSeed) {
				initialArtist = mergeArtistStats(initialArtist, artistCacheSeed);
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
					artist = await enrichArtistStatsBySearch(artist, token, nameHint, artist?.id || id);
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
			const topTracksForbidden = settled[1].status === "rejected" && isSpotifyForbiddenError(settled[1].reason);
			let topTracksRecovered = false;

			if (!topTracksForbidden && (artist?.id || "") !== (initialArtist?.id || "") && !topTracks.length) {
				try {
					topTracks = await fetchArtistTopTracksWithFallback(artist.id, token);
					topTracksRecovered = topTracks.length > 0;
				} catch (e) {}
			}
			if (!topTracksForbidden && !topTracks.length) {
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
			cacheArtistStats(artist);

			if (topTracksForbidden) {
				setStatus("Artiste charge. Les top morceaux ne sont pas accessibles avec ce token Spotify (403).", true);
				return;
			}

			if (settled[1].status === "rejected" && !topTracksRecovered && !topTracks.length) {
				setStatus("Artiste charge. Top morceaux indisponibles pour le moment.", true);
				return;
			}

			if (isArtistStatsMissing(artist)) {
				setStatus("Artiste charge. Certaines stats ne sont pas fournies par Spotify sur cet endpoint.");
				return;
			}

			setStatus("Artiste charge.");
			return;
		} catch (error) {
			if (String(error.message).includes("spotify_unauthorized")) {
				window.WithMeSpotify.clearSpotifyStoredAuth();
				setStatus("Session Spotify expiree. Reconnecte-toi.", true);
				return;
			}

			// Si erreur, tente fallback
			usedFallback = true;
		}
	}

	// Fallback MusicBrainz
	try {
		let artist = null;
		if (window.searchMusicBrainzArtists) {
			const results = await window.searchMusicBrainzArtists(nameHint || id, 1);
			artist = results && results[0];
		}
		if (!artist) {
			setStatus("Artiste introuvable sur MusicBrainz.", true);
			return;
		}
		// Top tracks
		let topTracks = [];
		if (window.searchMusicBrainzTracks) {
			topTracks = await window.searchMusicBrainzTracks(`artist:${artist.name}`, 5);
		}
		renderArtist(artist, topTracks);
		// Albums
		// MusicBrainz n’a pas d’API simple pour albums, mais on peut afficher les titres d’albums des tracks
		const albumsList = document.getElementById("albumsList");
		if (albumsList && topTracks.length) {
			const uniqueAlbums = Array.from(new Set(topTracks.map(t => t.album).filter(Boolean)));
			albumsList.innerHTML = uniqueAlbums.length ? uniqueAlbums.map(album => `<li>${album}</li>`).join("") : "<li>Aucun album disponible.</li>";
		}
		await fetchConcerts(artist.name);
		setStatus("Artiste charge (MusicBrainz).", false);
	} catch (e) {
		setStatus("Impossible de charger cet artiste.", true);
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
initArtistPage();
