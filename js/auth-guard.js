(async function () {
	if (!window.WithMeAuth) {
		window.location.href = "/html/login.html";
		return;
	}

	const user = await window.WithMeAuth.requireAuthOrRedirect("/html/login.html");
	if (!user) {
		return;
	}

	if (!user.spotifyLinked) {
		window.location.href = "/html/login.html?step=spotify";
		return;
	}

	const hasSpotifySession = typeof window.WithMeAuth.hasSpotifySession === "function"
		? window.WithMeAuth.hasSpotifySession()
		: false;

	if (!hasSpotifySession) {
		window.location.href = "/html/login.html?step=spotify&resync=1";
	}
})();
