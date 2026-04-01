const themeToggle = document.getElementById("themeToggle");
const profileForm = document.getElementById("profileForm");
const profileUsername = document.getElementById("profileUsername");
const profileEmail = document.getElementById("profileEmail");
const profileBio = document.getElementById("profileBio");
const profileStatus = document.getElementById("profileStatus");

const profileDisplayName = document.getElementById("profileDisplayName");
const profileDisplayEmail = document.getElementById("profileDisplayEmail");
const profileAvatar = document.getElementById("profileAvatar");
const profileBanner = document.getElementById("profileBanner");

const avatarInput = document.getElementById("avatarInput");
const bannerInput = document.getElementById("bannerInput");
const changeAvatarBtn = document.getElementById("changeAvatarBtn");
const changeBannerBtn = document.getElementById("changeBannerBtn");
const friendsStatus = document.getElementById("friendsStatus");
const friendsList = document.getElementById("friendsList");
const notificationsStatus = document.getElementById("notificationsStatus");
const incomingRequestsList = document.getElementById("incomingRequestsList");
const outgoingRequestsList = document.getElementById("outgoingRequestsList");

const PLACEHOLDER_AVATAR = "img/artist-focus.svg";

let currentProfile = null;
let avatarDataUrlDraft;
let bannerDataUrlDraft;

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
	profileStatus.textContent = message;
	profileStatus.classList.toggle("error", Boolean(isError));
}

function setFriendsStatus(message, isError = false) {
	if (!friendsStatus) {
		return;
	}
	friendsStatus.textContent = message;
	friendsStatus.classList.toggle("error", Boolean(isError));
}

function setNotificationsStatus(message, isError = false) {
	if (!notificationsStatus) {
		return;
	}
	notificationsStatus.textContent = message;
	notificationsStatus.classList.toggle("error", Boolean(isError));
}

function renderPreview(profile) {
	const username = String(profile?.username || "").trim() || "Profil";
	const email = String(profile?.email || "").trim() || "Compte WithMe";
	const bio = String(profile?.bio || "");
	const avatarUrl = avatarDataUrlDraft !== undefined
		? avatarDataUrlDraft
		: String(profile?.avatarUrl || "");
	const bannerUrl = bannerDataUrlDraft !== undefined
		? bannerDataUrlDraft
		: String(profile?.bannerUrl || "");

	profileDisplayName.textContent = username;
	profileDisplayEmail.textContent = email;
	profileAvatar.src = avatarUrl || PLACEHOLDER_AVATAR;
	profileBanner.style.backgroundImage = bannerUrl
		? `linear-gradient(120deg, rgba(18, 23, 38, 0.24), rgba(18, 23, 38, 0.05)), url('${bannerUrl}')`
		: "linear-gradient(120deg, #8fcff8, #c7a9ff)";

	profileUsername.value = username;
	profileEmail.value = email;
	profileBio.value = bio;
}

function fileToDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ""));
		reader.onerror = () => reject(new Error("file_read_error"));
		reader.readAsDataURL(file);
	});
}

async function handleImageInput(inputEl, target) {
	const file = inputEl?.files?.[0];
	if (!file) {
		return;
	}
	if (file.size > 2 * 1024 * 1024) {
		setStatus("Image trop lourde (max 2 Mo).", true);
		inputEl.value = "";
		return;
	}

	try {
		const dataUrl = await fileToDataUrl(file);
		if (!/^data:image\//i.test(dataUrl)) {
			setStatus("Format d'image invalide.", true);
			return;
		}
		if (target === "avatar") {
			avatarDataUrlDraft = dataUrl;
		} else {
			bannerDataUrlDraft = dataUrl;
		}
		renderPreview(currentProfile || {});
		setStatus("Image prete. Clique sur Enregistrer pour confirmer.");
	} catch (error) {
		setStatus("Impossible de lire cette image.", true);
	}
}

function parseProfileError(error) {
	const code = String(error?.message || "");
	switch (code) {
		case "username_too_short":
			return "Le pseudo doit contenir au moins 3 caracteres.";
		case "invalid_email":
			return "L'email est invalide.";
		case "bio_too_long":
			return "La bio depasse 400 caracteres.";
		case "account_already_exists":
			return "Ce pseudo ou cet email est deja utilise.";
		case "invalid_image_data":
			return "Image invalide. Selectionne un fichier image valide.";
		case "invalid_image_type":
			return "Format image non supporte. Utilise JPG, PNG, WEBP ou GIF.";
		case "image_too_large":
			return "Image trop lourde. Maximum 2 Mo.";
		default:
			return "Impossible de sauvegarder le profil.";
	}
}

function renderFriendsList(items) {
	if (!friendsList) {
		return;
	}

	friendsList.innerHTML = "";
	const list = Array.isArray(items) ? items : [];

	if (!list.length) {
		friendsList.innerHTML = '<li class="friend-item-empty">Aucun ami pour le moment.</li>';
		setFriendsStatus("Ajoute des personnes depuis la page utilisateur.");
		return;
	}

	for (const friend of list) {
		const item = document.createElement("li");
		item.className = "friend-item";
		item.innerHTML = `
			<a class="friend-item-link" href="/user.html?id=${encodeURIComponent(friend?.id || "")}">
				<img src="${friend?.avatarUrl || PLACEHOLDER_AVATAR}" alt="Avatar ${friend?.username || "Utilisateur"}" />
				<div>
					<strong>${friend?.username || "Utilisateur"}</strong>
					<small>${friend?.email || ""}</small>
				</div>
			</a>
			<button class="secondary-pill" type="button" data-remove-friend-id="${Number(friend?.id || 0)}">Retirer</button>
		`;
		friendsList.appendChild(item);
	}

	setFriendsStatus(`${list.length} ami(s).`);
}

function renderIncomingRequests(items) {
	if (!incomingRequestsList) {
		return;
	}

	incomingRequestsList.innerHTML = "";
	const list = Array.isArray(items) ? items : [];

	if (!list.length) {
		incomingRequestsList.innerHTML = '<li class="friend-item-empty">Aucune demande recue.</li>';
		return;
	}

	for (const request of list) {
		const item = document.createElement("li");
		item.className = "friend-item";
		item.innerHTML = `
			<a class="friend-item-link" href="/user.html?id=${encodeURIComponent(request?.userId || "")}">
				<img src="${request?.avatarUrl || PLACEHOLDER_AVATAR}" alt="Avatar ${request?.username || "Utilisateur"}" />
				<div>
					<strong>${request?.username || "Utilisateur"}</strong>
					<small>${request?.email || ""}</small>
				</div>
			</a>
			<div class="request-actions">
				<button class="secondary-pill" type="button" data-accept-request-id="${Number(request?.userId || 0)}">Accepter</button>
				<button class="secondary-pill" type="button" data-decline-request-id="${Number(request?.userId || 0)}">Refuser</button>
			</div>
		`;
		incomingRequestsList.appendChild(item);
	}
}

function renderOutgoingRequests(items) {
	if (!outgoingRequestsList) {
		return;
	}

	outgoingRequestsList.innerHTML = "";
	const list = Array.isArray(items) ? items : [];

	if (!list.length) {
		outgoingRequestsList.innerHTML = '<li class="friend-item-empty">Aucune demande envoyee.</li>';
		return;
	}

	for (const request of list) {
		const item = document.createElement("li");
		item.className = "friend-item";
		item.innerHTML = `
			<a class="friend-item-link" href="/user.html?id=${encodeURIComponent(request?.userId || "")}">
				<img src="${request?.avatarUrl || PLACEHOLDER_AVATAR}" alt="Avatar ${request?.username || "Utilisateur"}" />
				<div>
					<strong>${request?.username || "Utilisateur"}</strong>
					<small>${request?.email || ""}</small>
				</div>
			</a>
			<button class="secondary-pill" type="button" data-cancel-request-id="${Number(request?.userId || 0)}">Annuler</button>
		`;
		outgoingRequestsList.appendChild(item);
	}
}

async function loadNotificationsAndRequests() {
	if (!window.WithMeAuth?.getFriendRequests || !window.WithMeAuth?.getNotifications) {
		return;
	}

	try {
		setNotificationsStatus("Chargement des notifications...");
		const [requests, notifications] = await Promise.all([
			window.WithMeAuth.getFriendRequests(),
			window.WithMeAuth.getNotifications()
		]);

		renderIncomingRequests(requests?.incoming || []);
		renderOutgoingRequests(requests?.outgoing || []);
		setNotificationsStatus(`${Number(notifications?.unreadCount || 0)} demande(s) en attente.`);
	} catch (error) {
		setNotificationsStatus("Impossible de charger les notifications.", true);
	}
}

async function loadFriends() {
	try {
		setFriendsStatus("Chargement des amis...");
		const items = await window.WithMeAuth.getFriends();
		renderFriendsList(items);
	} catch (error) {
		setFriendsStatus("Impossible de charger la liste d'amis.", true);
	}
}

async function handleRemoveFriendClick(target) {
	const removeId = Number(target?.dataset?.removeFriendId || 0);
	if (!removeId) {
		return;
	}

	target.disabled = true;
	setFriendsStatus("Suppression de l'ami...");

	try {
		await window.WithMeAuth.removeFriend(removeId);
		await loadFriends();
	} catch (error) {
		setFriendsStatus("Impossible de retirer cet ami.", true);
	} finally {
		target.disabled = false;
	}
}

async function handleRequestAction(action, userId, triggerBtn) {
	const targetUserId = Number(userId || 0);
	if (!targetUserId) {
		return;
	}

	if (triggerBtn instanceof HTMLButtonElement) {
		triggerBtn.disabled = true;
	}

	try {
		setNotificationsStatus("Mise a jour des demandes...");
		if (action === "accept") {
			await window.WithMeAuth.acceptFriendRequest(targetUserId);
			setNotificationsStatus("Demande acceptee.");
		} else {
			await window.WithMeAuth.declineFriendRequest(targetUserId);
			setNotificationsStatus(action === "cancel" ? "Demande annulee." : "Demande refusee.");
		}

		await Promise.all([
			loadFriends(),
			loadNotificationsAndRequests()
		]);
	} catch (error) {
		setNotificationsStatus("Impossible de mettre a jour cette demande.", true);
	} finally {
		if (triggerBtn instanceof HTMLButtonElement) {
			triggerBtn.disabled = false;
		}
	}
}

async function loadProfile() {
	try {
		const user = await window.WithMeAuth.requireAuthOrRedirect(window.WithMeAuth.getLoginUrl());
		if (!user) {
			return;
		}
		const profile = await window.WithMeAuth.getProfile();
		currentProfile = profile || user;
		avatarDataUrlDraft = undefined;
		bannerDataUrlDraft = undefined;
		renderPreview(currentProfile);
		await Promise.all([
			loadFriends(),
			loadNotificationsAndRequests()
		]);
		setStatus("Profil charge.");
	} catch (error) {
		setStatus("Impossible de charger le profil.", true);
	}
}

profileForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	try {
		setStatus("Sauvegarde en cours...");
		const payload = {
			username: String(profileUsername.value || "").trim(),
			email: String(profileEmail.value || "").trim(),
			bio: String(profileBio.value || "").trim()
		};

		if (avatarDataUrlDraft !== undefined) {
			payload.avatarDataUrl = avatarDataUrlDraft;
		}
		if (bannerDataUrlDraft !== undefined) {
			payload.bannerDataUrl = bannerDataUrlDraft;
		}

		const updated = await window.WithMeAuth.updateProfile(payload);
		currentProfile = updated || currentProfile;
		avatarDataUrlDraft = undefined;
		bannerDataUrlDraft = undefined;
		renderPreview(currentProfile || {});
		setStatus("Profil enregistre.");
	} catch (error) {
		setStatus(parseProfileError(error), true);
	}
});

if (avatarInput) {
	avatarInput.addEventListener("change", () => {
		handleImageInput(avatarInput, "avatar");
	});
}

if (bannerInput) {
	bannerInput.addEventListener("change", () => {
		handleImageInput(bannerInput, "banner");
	});
}

if (changeAvatarBtn) {
	changeAvatarBtn.addEventListener("click", () => {
		if (avatarInput) {
			avatarInput.click();
		}
	});
}

if (changeBannerBtn) {
	changeBannerBtn.addEventListener("click", () => {
		if (bannerInput) {
			bannerInput.click();
		}
	});
}

if (friendsList) {
	friendsList.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		if (!target.matches("button[data-remove-friend-id]")) {
			return;
		}
		handleRemoveFriendClick(target);
	});
}

if (incomingRequestsList) {
	incomingRequestsList.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		if (target.matches("button[data-accept-request-id]")) {
			handleRequestAction("accept", target.dataset.acceptRequestId, target);
			return;
		}
		if (target.matches("button[data-decline-request-id]")) {
			handleRequestAction("decline", target.dataset.declineRequestId, target);
		}
	});
}

if (outgoingRequestsList) {
	outgoingRequestsList.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		if (!target.matches("button[data-cancel-request-id]")) {
			return;
		}
		handleRequestAction("cancel", target.dataset.cancelRequestId, target);
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

(async function bootProfilePage() {
	initTheme();
	loadProfile();
})();
