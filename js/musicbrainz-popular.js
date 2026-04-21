// Charge des musiques populaires depuis MusicBrainz
// Utilisé quand l'utilisateur n'a pas synchronisé Spotify

async function fetchPopularTracksFromMusicBrainz(limit = 10) {
    const url = `https://musicbrainz.org/ws/2/recording?query=tag:popular&fmt=json&limit=${limit}`;
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'WithMeApp/1.0 (https://withme.app)'
        }
    });
    if (!response.ok) {
        throw new Error('Erreur lors de la récupération des musiques populaires');
    }
    const data = await response.json();
    return (data.recordings || []).map(function(rec) {
        // Cherche le release-group MBID pour la pochette
        const releaseGroupId = rec["releases"]?.[0]?.["release-group"] || rec["releases"]?.[0]?.id || "";
        return {
            title: rec.title,
            artist: (rec["artist-credit"] && rec["artist-credit"][0] && rec["artist-credit"][0].name) ? rec["artist-credit"][0].name : 'Artiste inconnu',
            mbid: rec.id,
            releaseGroupId,
            coverUrl: window.getAlbumCoverUrl ? window.getAlbumCoverUrl(releaseGroupId) : 'img/cover-electric.svg'
        };
    });
}

// Affiche les musiques populaires dans la grille rapide
async function showPopularTracksIfNoSpotify() {
    // Si mode no-sync, toujours afficher MusicBrainz
    var isNoSync = localStorage.getItem("WithMe-no-sync") === "1" || window.location.search.includes("nosync=1");
    var hasSpotify = window.WithMeAuth && window.WithMeAuth.hasSpotifySession && window.WithMeAuth.hasSpotifySession();
    if (isNoSync || !hasSpotify) {
        var quickCards = Array.from(document.querySelectorAll('.quick-card'));
        try {
            var tracks = await fetchPopularTracksFromMusicBrainz(quickCards.length);
            quickCards.forEach(function(card, i) {
                var track = tracks[i];
                if (track) {
                    card.querySelector('span').textContent = track.title;
                    var artistEl = card.querySelector('p');
                    if (artistEl) artistEl.textContent = track.artist;
                    card.querySelector('img').src = track.coverUrl || 'img/cover-electric.svg';
                    card.querySelector('img').alt = track.title;
                }
            });
        } catch (e) {
            // fallback silencieux
        }
    }
}

window.showPopularTracksIfNoSpotify = showPopularTracksIfNoSpotify;
