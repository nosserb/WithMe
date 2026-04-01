(async function () {
	if (!window.WithMeAuth) {
		window.location.href = "/login.html";
		return;
	}

	const user = await window.WithMeAuth.requireAuthOrRedirect("/login.html");
	if (!user) {
		return;
	}

	if (!user.spotifyLinked) {
		window.location.href = "/login.html?step=spotify";
		return;
	}

	const hasSpotifySession = typeof window.WithMeAuth.hasSpotifySession === "function"
		? window.WithMeAuth.hasSpotifySession()
		: false;

	if (!hasSpotifySession) {
		window.location.href = "/login.html?step=spotify&resync=1";
	}
})();
