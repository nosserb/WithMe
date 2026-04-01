const themeToggle = document.getElementById("themeToggle");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const userAvatar = document.getElementById("userAvatar");
const userBanner = document.getElementById("userBanner");
const userBio = document.getElementById("userBio");
const userSpotifyState = document.getElementById("userSpotifyState");
const friendActionBtn = document.getElementById("friendActionBtn");
const friendSecondaryBtn = document.getElementById("friendSecondaryBtn");
const friendStatus = document.getElementById("friendStatus");

const PLACEHOLDER_AVATAR = "img/artist-focus.svg";

let currentViewedUserId = 0;
let currentFriendship = {
	isSelf: false,
	isFriend: false,
	hasIncomingRequest: false,
	hasOutgoingRequest: false
};

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

function getUserIdFromQuery() {
	const params = new URLSearchParams(window.location.search);
	return Number(params.get("id") || 0);
}

function renderUserProfile(profile) {
	const username = String(profile?.username || "Utilisateur").trim() || "Utilisateur";
	const email = String(profile?.email || "").trim() || "Compte WithMe";
	const bio = String(profile?.bio || "").trim() || "Aucune bio.";
	const avatarUrl = String(profile?.avatarUrl || "").trim() || PLACEHOLDER_AVATAR;
	const bannerUrl = String(profile?.bannerUrl || "").trim();

	userName.textContent = username;
	userEmail.textContent = email;
	userBio.textContent = bio;
	userAvatar.src = avatarUrl;
	userAvatar.alt = `Avatar de ${username}`;
	userBanner.style.backgroundImage = bannerUrl
		? `linear-gradient(120deg, rgba(18, 23, 38, 0.24), rgba(18, 23, 38, 0.05)), url('${bannerUrl}')`
		: "linear-gradient(120deg, #8fcff8, #c7a9ff)";

	if (profile?.spotifyLinked) {
		const spotifyName = String(profile?.spotifyDisplayName || "").trim();
		userSpotifyState.textContent = spotifyName
			? `Spotify lie: ${spotifyName}`
			: "Spotify lie";
	} else {
		userSpotifyState.textContent = "Spotify non lie";
	}

	const friendship = profile?.friendship || {};
	currentFriendship = {
		isSelf: Boolean(friendship.isSelf),
		isFriend: Boolean(friendship.isFriend),
		hasIncomingRequest: Boolean(friendship.hasIncomingRequest),
		hasOutgoingRequest: Boolean(friendship.hasOutgoingRequest)
	};
	renderFriendAction();
}

function setFriendStatus(message, isError = false) {
	if (!friendStatus) {
		return;
	}
	friendStatus.textContent = message;
	friendStatus.classList.toggle("error", Boolean(isError));
}

function renderFriendAction(options = {}) {
	const keepStatus = Boolean(options.keepStatus);
	if (!friendActionBtn) {
		return;
	}
	if (friendSecondaryBtn) {
		friendSecondaryBtn.hidden = true;
		friendSecondaryBtn.disabled = false;
		friendSecondaryBtn.textContent = "";
	}

	if (currentFriendship.isSelf) {
		friendActionBtn.disabled = true;
		friendActionBtn.textContent = "Ton profil";
		if (!keepStatus) {
			setFriendStatus("Tu ne peux pas t'ajouter toi-meme.");
		}
		return;
	}

	if (currentFriendship.isFriend) {
		friendActionBtn.disabled = false;
		friendActionBtn.textContent = "Retirer des amis";
		if (!keepStatus) {
			setFriendStatus("Vous etes deja amis.");
		}
		return;
	}

	if (currentFriendship.hasIncomingRequest) {
		friendActionBtn.disabled = false;
		friendActionBtn.textContent = "Accepter la demande";
		if (friendSecondaryBtn) {
			friendSecondaryBtn.hidden = false;
			friendSecondaryBtn.textContent = "Refuser";
		}
		if (!keepStatus) {
			setFriendStatus("Cette personne t'a envoye une demande.");
		}
		return;
	}

	if (currentFriendship.hasOutgoingRequest) {
		friendActionBtn.disabled = true;
		friendActionBtn.textContent = "Demande envoyee";
		if (friendSecondaryBtn) {
			friendSecondaryBtn.hidden = false;
			friendSecondaryBtn.textContent = "Annuler";
		}
		if (!keepStatus) {
			setFriendStatus("En attente de reponse.");
		}
		return;
	}

	friendActionBtn.disabled = false;
	friendActionBtn.textContent = "Envoyer la demande";
	if (!keepStatus) {
		setFriendStatus("Envoie une demande d'ami.");
	}
}

async function refreshRelationshipState() {
	const profile = await fetchPublicUserProfile(currentViewedUserId);
	const friendship = profile?.friendship || {};
	currentFriendship = {
		isSelf: Boolean(friendship.isSelf),
		isFriend: Boolean(friendship.isFriend),
		hasIncomingRequest: Boolean(friendship.hasIncomingRequest),
		hasOutgoingRequest: Boolean(friendship.hasOutgoingRequest)
	};
}

async function fetchPublicUserProfile(userId) {
	const token = window.WithMeAuth?.getStoredToken?.() || "";
	if (!token) {
		throw new Error("auth_required");
	}

	const response = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
		headers: {
			Authorization: `Bearer ${token}`
		}
	});

	if (!response.ok) {
		if (response.status === 401) {
			throw new Error("auth_required");
		}
		if (response.status === 404) {
			throw new Error("user_not_found");
		}
		throw new Error("request_failed");
	}

	const payload = await response.json();
	return payload?.user || null;
}

async function toggleFriendship() {
	if (!friendActionBtn || !currentViewedUserId || currentFriendship.isSelf) {
		return;
	}

	friendActionBtn.disabled = true;
	if (friendSecondaryBtn) {
		friendSecondaryBtn.disabled = true;
	}
	setFriendStatus("Mise a jour...", false);

	try {
		if (currentFriendship.isFriend) {
			await window.WithMeAuth.removeFriend(currentViewedUserId);
			setFriendStatus("Ami retire.", false);
		} else if (currentFriendship.hasIncomingRequest) {
			await window.WithMeAuth.acceptFriendRequest(currentViewedUserId);
			setFriendStatus("Demande acceptee.", false);
		} else {
			await window.WithMeAuth.addFriend(currentViewedUserId);
			setFriendStatus("Demande envoyee.", false);
		}

		await refreshRelationshipState();
	} catch (error) {
		const errorCode = String(error?.message || "");
		if (errorCode === "auth_required") {
			setFriendStatus("Session expiree, reconnecte-toi.", true);
			window.WithMeAuth.redirectToLogin();
			return;
		}
		if (errorCode === "incoming_request_exists") {
			setFriendStatus("Cette personne t'a deja envoye une demande: accepte-la.", true);
			await refreshRelationshipState();
		} else {
			setFriendStatus("Impossible de mettre a jour la relation.", true);
		}
	} finally {
		renderFriendAction({ keepStatus: true });
		if (friendSecondaryBtn) {
			friendSecondaryBtn.disabled = false;
		}
	}
}

async function handleSecondaryFriendAction() {
	if (!friendSecondaryBtn || !currentViewedUserId || currentFriendship.isSelf) {
		return;
	}

	friendSecondaryBtn.disabled = true;
	setFriendStatus("Mise a jour...", false);

	try {
		if (currentFriendship.hasIncomingRequest || currentFriendship.hasOutgoingRequest) {
			const result = await window.WithMeAuth.declineFriendRequest(currentViewedUserId);
			if (String(result?.action || "") === "cancelled") {
				setFriendStatus("Demande annulee.");
			} else {
				setFriendStatus("Demande refusee.");
			}
		}

		await refreshRelationshipState();
	} catch (error) {
		const errorCode = String(error?.message || "");
		if (errorCode === "auth_required") {
			window.WithMeAuth.redirectToLogin();
			return;
		}
		setFriendStatus("Impossible de mettre a jour la demande.", true);
	} finally {
		renderFriendAction({ keepStatus: true });
	}
}

async function bootUserPage() {
	const authUser = await window.WithMeAuth.requireAuthOrRedirect(window.WithMeAuth.getLoginUrl());
	if (!authUser) {
		return;
	}

	const userId = getUserIdFromQuery();
	currentViewedUserId = userId;
	if (!userId) {
		userName.textContent = "Utilisateur introuvable";
		userBio.textContent = "Identifiant manquant.";
		return;
	}

	try {
		const profile = await fetchPublicUserProfile(userId);
		if (!profile) {
			throw new Error("user_not_found");
		}
		renderUserProfile(profile);
	} catch (error) {
		const code = String(error?.message || "");
		if (code === "auth_required") {
			window.WithMeAuth.redirectToLogin();
			return;
		}
		if (code === "user_not_found") {
			userName.textContent = "Utilisateur introuvable";
			userBio.textContent = "Ce profil n'existe pas ou n'est plus disponible.";
			return;
		}
		userName.textContent = "Erreur";
		userBio.textContent = "Impossible de charger ce profil pour le moment.";
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

if (friendActionBtn) {
	friendActionBtn.addEventListener("click", () => {
		toggleFriendship();
	});
}

if (friendSecondaryBtn) {
	friendSecondaryBtn.addEventListener("click", () => {
		handleSecondaryFriendAction();
	});
}

(async function initUserPage() {
	initTheme();
	bootUserPage();
})();
