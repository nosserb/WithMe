(async function () {
	if (!window.WithMeAuth) {
		window.location.href = "login.html";
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

	if (!user.spotifyLinked) {
		window.WithMeAuth.redirectToLogin("step=spotify");
		return;
	}

	const hasSpotifySession = typeof window.WithMeAuth.hasSpotifySession === "function"
		? window.WithMeAuth.hasSpotifySession()
		: false;

	if (!hasSpotifySession) {
		window.WithMeAuth.redirectToLogin("step=spotify&resync=1");
	}
})();
