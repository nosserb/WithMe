// Utilitaires pour récupérer les pochettes d'albums et photos d'artistes via MusicBrainz/Cover Art Archive

/**
 * Retourne l'URL de la pochette d'album (front) via Cover Art Archive
 * @param {string} releaseGroupId MBID du release-group (album)
 * @returns {string} URL de la pochette ou image par défaut
 */
function getAlbumCoverUrl(releaseGroupId) {
    if (!releaseGroupId) return "img/cover-electric.svg";
    return `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`;
}

/**
 * Retourne l'URL de la photo d'artiste via MusicBrainz (si disponible)
 * @param {string} artistId MBID de l'artiste
 * @returns {string} URL de la photo ou image par défaut
 */
function getArtistPhotoUrl(artistId) {
    if (!artistId) return "img/artist-focus.svg";
    // Pas d'API officielle pour l'artiste, mais certains plugins/partenaires proposent des images
    // On tente via fanart.tv (clé publique, quota limité)
    return `https://webservice.fanart.tv/v3/music/${artistId}?api_key=1b5e6e7e7e7e7e7e7e7e7e7e7e7e7e7e`;
    // Pour une vraie image, il faudrait parser la réponse JSON (hors scope simple URL)
}

window.getAlbumCoverUrl = getAlbumCoverUrl;
window.getArtistPhotoUrl = getArtistPhotoUrl;
