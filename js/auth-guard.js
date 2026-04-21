(async function () {
	if (!window.WithMeAuth) {
		window.location.href = "login.html";
		return;
	}

	// Autorise l'accès si mode no-sync
	if (localStorage.getItem("WithMe-no-sync") === "1" || window.location.search.includes("nosync=1")) {
		return;
	}

	const loginUrl = window.WithMeAuth.getLoginUrl();
	const currentPath = String(window.location.pathname || "").toLowerCase();
	const isSearchPage = currentPath.endsWith("/search.html") || currentPath.endsWith("search.html");

	const user = await window.WithMeAuth.requireAuthOrRedirect(loginUrl);
	if (!user) {
		return;
	}

	// Search page must work for WithMe user lookup even without Spotify session.
	if (isSearchPage) {
		return;
	}

	const hasSpotifySession = typeof window.WithMeAuth.hasSpotifySession === "function"
		? window.WithMeAuth.hasSpotifySession()
		: false;

	if (!user.spotifyLinked && !hasSpotifySession) {
		window.WithMeAuth.redirectToLogin("step=spotify");
		return;
	}

	if (!hasSpotifySession) {
		window.WithMeAuth.redirectToLogin("step=spotify&resync=1");
	}
})();
