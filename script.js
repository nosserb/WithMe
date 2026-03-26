const playToggle = document.getElementById("playToggle");
const progressFill = document.getElementById("progressFill");
const playerTitle = document.getElementById("playerTitle");
const playerArtist = document.getElementById("playerArtist");
const playerCover = document.getElementById("playerCover");
const themeToggle = document.getElementById("themeToggle");

const focusCover = document.getElementById("focusCover");
const focusTitle = document.getElementById("focusTitle");
const focusArtist = document.getElementById("focusArtist");
const focusListeners = document.getElementById("focusListeners");

const selectableCards = document.querySelectorAll(".quick-card, .album-card");

let isPlaying = false;
let progress = 22;
let timer = null;

function applyTheme(mode) {
	const isDark = mode === "dark";
	document.body.classList.toggle("dark-mode", isDark);
	if (themeToggle) {
		themeToggle.textContent = isDark ? "Mode clair" : "Mode sombre";
		themeToggle.setAttribute("aria-label", isDark ? "Activer le mode clair" : "Activer le mode sombre");
	}
}

function initTheme() {
	const storedTheme = localStorage.getItem("spoteur-theme");
	const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
	const initialTheme = storedTheme || (prefersDark ? "dark" : "light");
	applyTheme(initialTheme);
}

function setPlaybackState(playing) {
	isPlaying = playing;
	playToggle.textContent = isPlaying ? "Pause" : "Play";
}

function tickProgress() {
	if (!isPlaying) {
		return;
	}

	progress += 0.4;
	if (progress > 100) {
		progress = 0;
	}
	progressFill.style.width = `${progress}%`;
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

playToggle.addEventListener("click", () => {
	setPlaybackState(!isPlaying);
});

selectableCards.forEach((card) => {
	card.addEventListener("click", () => {
		const title = card.dataset.title || "Unknown title";
		const artist = card.dataset.artist || "Unknown artist";
		const cover = card.dataset.cover || "";

		playerTitle.textContent = title;
		playerArtist.textContent = artist;
		if (cover) {
			playerCover.src = cover;
			updateFocusPanel(title, artist, cover);
		}

		progress = 8;
		progressFill.style.width = `${progress}%`;
		setPlaybackState(true);
	});
});

if (themeToggle) {
	themeToggle.addEventListener("click", () => {
		const isDark = document.body.classList.contains("dark-mode");
		const nextTheme = isDark ? "light" : "dark";
		applyTheme(nextTheme);
		localStorage.setItem("spoteur-theme", nextTheme);
	});
}

initTheme();
startProgressLoop();
