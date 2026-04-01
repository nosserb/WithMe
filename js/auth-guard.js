(async function () {
	if (!window.WithMeAuth) {
		window.location.href = "login.html";
		return;
	}

	const loginUrl = window.WithMeAuth.getLoginUrl();

	const user = await window.WithMeAuth.requireAuthOrRedirect(loginUrl);
	if (!user) {
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
