// Recherche MusicBrainz pour artistes et morceaux (fallback sans Spotify)

async function searchMusicBrainzTracks(query, limit = 10) {
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error('Erreur MusicBrainz');
    const data = await response.json();
    return (data.recordings || []).map(rec => {
        const releaseGroupId = rec.releases?.[0]?.['release-group'] || rec.releases?.[0]?.id || "";
        return {
            id: rec.id,
            title: rec.title,
            artist: rec['artist-credit']?.[0]?.name || 'Artiste inconnu',
            album: rec.releases?.[0]?.title || '',
            duration_ms: rec.length || 0,
            releaseGroupId,
            coverUrl: window.getAlbumCoverUrl ? window.getAlbumCoverUrl(releaseGroupId) : 'img/cover-electric.svg'
        };
    });
}

async function searchMusicBrainzArtists(query, limit = 10) {
    const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error('Erreur MusicBrainz');
    const data = await response.json();
    return (data.artists || []).map(art => ({
        id: art.id,
        name: art.name,
        genres: art.tags?.map(t => t.name) || [],
        country: art.country || '',
        disambiguation: art.disambiguation || ''
    }));
}

window.searchMusicBrainzTracks = searchMusicBrainzTracks;
window.searchMusicBrainzArtists = searchMusicBrainzArtists;
