window.WITHME_CONFIG = {
	spotifyClientId: "1418bd40adb94fc296ae25dbf93c7372",
	spotifyRedirectUri: "https://127.0.0.1:3443/html/login.html",
	redirectUri: "https://127.0.0.1:3443/html/login.html",
	localRedirectUri: "https://127.0.0.1:3443/html/login.html",
	postLoginRedirect: "https://127.0.0.1:3443/html/index.html",
	apiBaseUrl: "",
	TicketmasterKey: "eD59GweBRt9SXEpsiPs87U6RJGHw0CL8",
	firebase: {
		apiKey: "AIzaSyBQL4v0qvm-784ptWrnzz_lVeeeEhdqf3k",
		authDomain: "withme-aa73b.firebaseapp.com",
		projectId: "withme-aa73b",
		storageBucket: "withme-aa73b.firebasestorage.app",
		messagingSenderId: "912298983992",
		appId: "1:912298983992:web:ffc6ffeb3e17a904655ccd",
		measurementId: "G-P0FZTMXYG8"
	}
};

(function initFirebaseWebSdk() {
	const firebaseConfig = window.WITHME_CONFIG?.firebase;
	if (!firebaseConfig || !firebaseConfig.apiKey) {
		return;
	}

	if (window.WithMeFirebase?.isReady) {
		return;
	}

	function loadScript(src) {
		return new Promise((resolve, reject) => {
			const existing = document.querySelector(`script[data-withme-sdk=\"${src}\"]`);
			if (existing) {
				if (existing.dataset.withmeLoaded === "1") {
					resolve();
					return;
				}
				if (window.firebase && src.includes("firebase-app-compat")) {
					resolve();
					return;
				}
				if (window.firebase?.analytics && src.includes("firebase-analytics-compat")) {
					resolve();
					return;
				}
				existing.addEventListener("load", () => resolve(), { once: true });
				existing.addEventListener("error", () => reject(new Error(`sdk_load_failed:${src}`)), { once: true });
				return;
			}

			const script = document.createElement("script");
			script.src = src;
			script.async = true;
			script.defer = true;
			script.dataset.withmeSdk = src;
			script.onload = () => {
				script.dataset.withmeLoaded = "1";
				resolve();
			};
			script.onerror = () => reject(new Error(`sdk_load_failed:${src}`));
			document.head.appendChild(script);
		});
	}

	Promise.all([
		loadScript("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js"),
		loadScript("https://www.gstatic.com/firebasejs/10.13.2/firebase-analytics-compat.js")
	])
		.then(() => {
			if (!window.firebase) {
				throw new Error("firebase_global_missing");
			}

			const app = window.firebase.apps?.length
				? window.firebase.app()
				: window.firebase.initializeApp(firebaseConfig);

			let analytics = null;
			if (firebaseConfig.measurementId && window.location.protocol === "https:") {
				try {
					analytics = window.firebase.analytics(app);
				} catch (e) {
					analytics = null;
				}
			}

			window.WithMeFirebase = {
				firebase: window.firebase,
				app,
				analytics,
				config: firebaseConfig,
				isReady: true
			};

			window.dispatchEvent(new CustomEvent("withme:firebase-ready", {
				detail: window.WithMeFirebase
			}));
		})
		.catch((error) => {
			window.WithMeFirebase = {
				firebase: null,
				app: null,
				analytics: null,
				config: firebaseConfig,
				isReady: false,
				error: String(error?.message || error)
			};
			console.error("[WithMe] Firebase init failed", error);
		});
})();
