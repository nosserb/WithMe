const themeToggle = document.getElementById("themeToggle");
const mobileConcertStatus = document.getElementById("mobileConcertStatus");
const mobileConcertList = document.getElementById("mobileConcertList");

const TICKETMASTER_KEY = String(
	window.WITHME_CONFIG?.TicketmasterKey
	|| window.WITHME_CONFIG?.ticketmasterKey
	|| window.WITHME_CONFIG?.ticketmasterApiKey
	|| ""
).trim();

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

function setStatus(message) {
	if (mobileConcertStatus) {
		mobileConcertStatus.textContent = message;
	}
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

function getFallbackConcertArtists() {
	return [
		"The Weeknd",
		"Dua Lipa",
		"Lomepal",
		"Billie Eilish",
		"Ninho"
	];
}

async function fetchConcertsForArtist(artistName) {
	if (!artistName || !TICKETMASTER_KEY) {
		return [];
	}

	const baseUrl = "https://app.ticketmaster.com/discovery/v2/events.json";
	const startDateTime = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
	const params = new URLSearchParams({
		apikey: TICKETMASTER_KEY,
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

	for (const url of proxiedUrls) {
		try {
			const response = await fetch(url);
			if (!response.ok) {
				continue;
			}
			const payload = await response.json();
			const normalized = typeof payload?.contents === "string"
				? JSON.parse(payload.contents)
				: payload;
			const events = normalized?._embedded?.events || [];
			if (Array.isArray(events) && events.length) {
				return events.map((eventItem) => mapConcertItem(eventItem, artistName)).filter(Boolean);
			}
		} catch (e) {
			continue;
		}
	}

	return [];
}

async function fetchTopArtists() {
	if (!window.WithMeSpotify?.getValidSpotifyToken || !window.WithMeSpotify?.spotifyGet) {
		return [];
	}

	const token = await window.WithMeSpotify.getValidSpotifyToken(window.WITHME_CONFIG?.spotifyClientId || "");
	if (!token) {
		return [];
	}

	try {
		const topArtistsRes = await window.WithMeSpotify.spotifyGet("/me/top/artists?limit=5&time_range=short_term", token);
		return (topArtistsRes?.items || [])
			.map((artist) => String(artist?.name || "").trim())
			.filter(Boolean)
			.slice(0, 5);
	} catch (error) {
		return [];
	}
}

async function fetchMobileConcerts() {
	const spotifyArtists = await fetchTopArtists();
	const artists = spotifyArtists.length ? spotifyArtists : getFallbackConcertArtists();

	const settled = await Promise.allSettled(artists.map((name) => fetchConcertsForArtist(name)));
	const merged = settled
		.filter((item) => item.status === "fulfilled")
		.flatMap((item) => item.value || []);

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
	return unique.slice(0, 12);
}

function renderConcerts(concerts) {
	if (!mobileConcertList) {
		return;
	}

	if (!Array.isArray(concerts) || !concerts.length) {
		mobileConcertList.innerHTML = "<li><span>i</span><strong>Aucun concert trouve</strong><em>Relance plus tard</em></li>";
		setStatus("Aucun concert disponible pour le moment.");
		return;
	}

	mobileConcertList.innerHTML = "";
	setStatus(`${concerts.length} concerts trouves.`);

	for (const concert of concerts) {
		const location = `${concert.venue} · ${concert.city}${concert.country ? `, ${concert.country}` : ""}`;
		const item = document.createElement("li");
		item.innerHTML = `<span>${concert.when}</span><strong>${concert.artist}</strong><em>${location}</em>`;

		const chatLink = document.createElement("a");
		chatLink.className = "detail-link";
		chatLink.href = `concert-chat.html?concertKey=${encodeURIComponent(concert.chatKey)}&artist=${encodeURIComponent(concert.artist)}`;
		chatLink.textContent = "Ouvrir le chat";
		item.appendChild(chatLink);

		if (concert.url) {
			const ticketLink = document.createElement("a");
			ticketLink.className = "detail-link";
			ticketLink.href = concert.url;
			ticketLink.target = "_blank";
			ticketLink.rel = "noopener noreferrer";
			ticketLink.textContent = "Billets";
			item.appendChild(ticketLink);
		}

		mobileConcertList.appendChild(item);
	}
}

async function bootMobileConcertPage() {
	initTheme();
	setStatus("Chargement des concerts...");

	try {
		const concerts = await fetchMobileConcerts();
		renderConcerts(concerts);
	} catch (error) {
		setStatus("Impossible de charger les concerts.");
		if (mobileConcertList) {
			mobileConcertList.innerHTML = "<li><span>!</span><strong>Erreur de chargement</strong><em>Reessaie dans quelques instants</em></li>";
		}
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

bootMobileConcertPage();
