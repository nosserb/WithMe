(function () {
	async function initHeaderAuth() {
		const authBtn = document.getElementById("authActionBtn");
		if (!authBtn || !window.WithMeAuth) {
			return;
		}

		authBtn.textContent = "Connexion";
		authBtn.setAttribute("href", window.WithMeAuth.getLoginUrl());

		if (!window.WithMeAuth.getStoredToken()) {
			return;
		}

		let user = null;
		try {
			user = await window.WithMeAuth.me();
		} catch (e) {
			user = null;
		}

		if (!user) {
			return;
		}

		authBtn.textContent = "Deconnexion";
		authBtn.setAttribute("href", "#");
		authBtn.addEventListener("click", async (event) => {
			event.preventDefault();
			authBtn.setAttribute("aria-disabled", "true");
			authBtn.textContent = "Deconnexion...";
			try {
				await window.WithMeAuth.logout();
			} finally {
				window.WithMeAuth.redirectToLogin();
			}
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initHeaderAuth);
	} else {
		initHeaderAuth();
	}
})();
