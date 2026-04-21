// Charge des musiques populaires depuis MusicBrainz
// Utilisé quand l'utilisateur n'a pas synchronisé Spotify

async function fetchPopularTracksFromMusicBrainz(limit = 10) {
    const url = `https://musicbrainz.org/ws/2/recording?query=tag:popular&fmt=json&limit=${limit}`;
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error('Erreur lors de la récupération des musiques populaires');
    }
    const data = await response.json();
    return (data.recordings || []).map(rec => ({
        title: rec.title,
        artist: rec['artist-credit']?.[0]?.name || 'Artiste inconnu',
        mbid: rec.id
    }));
}

// Affiche les musiques populaires dans la grille rapide
async function showPopularTracksIfNoSpotify() {
    // Si mode no-sync, toujours afficher MusicBrainz
    if (localStorage.getItem("WithMe-no-sync") === "1" || window.location.search.includes("nosync=1")) {
        const quickCards = Array.from(document.querySelectorAll('.quick-card'));
        try {
            const tracks = await fetchPopularTracksFromMusicBrainz(quickCards.length);
            quickCards.forEach((card, i) => {
                const track = tracks[i];
                if (track) {
                    card.querySelector('span').textContent = track.title;
                    card.querySelector('p')?.textContent = track.artist;
                    card.querySelector('img').src = 'img/artist-focus.svg';
                    card.querySelector('img').alt = track.title;
                }
            });
        } catch (e) {
            // fallback silencieux
        }
        return;
    }
    // Sinon, fallback si pas de session Spotify
    if (window.WithMeAuth && window.WithMeAuth.hasSpotifySession && window.WithMeAuth.hasSpotifySession()) {
        return;
    }
    const quickCards = Array.from(document.querySelectorAll('.quick-card'));
    try {
        const tracks = await fetchPopularTracksFromMusicBrainz(quickCards.length);
        quickCards.forEach((card, i) => {
            const track = tracks[i];
            if (track) {
                card.querySelector('span').textContent = track.title;
                card.querySelector('p')?.textContent = track.artist;
                card.querySelector('img').src = 'img/artist-focus.svg';
                card.querySelector('img').alt = track.title;
            }
        });
    } catch (e) {
        // fallback silencieux
    }
}

window.showPopularTracksIfNoSpotify = showPopularTracksIfNoSpotify;
