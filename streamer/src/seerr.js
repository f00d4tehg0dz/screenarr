// A small client for Seerr (also works with Overseerr and Jellyseerr, which
// share the same API). Search for a title, ask for it, see what has arrived.

const POSTER_BASE = "https://image.tmdb.org/t/p/w500";

// Seerr's own numbers for where a title stands.
export const STATUS = { PENDING: 2, PROCESSING: 3, PARTIAL: 4, AVAILABLE: 5 };

const year = (date) => (date ? ` (${String(date).slice(0, 4)})` : "");

function toChoice(result) {
  const isShow = result.mediaType === "tv";
  const name = isShow ? result.name : result.title;
  return {
    mediaType: result.mediaType,
    mediaId: result.id,
    title: `${name}${year(isShow ? result.firstAirDate : result.releaseDate)}`,
    kind: isShow ? "Show" : "Movie",
    status: result.mediaInfo?.status ?? 0,
    poster: result.posterPath ? POSTER_BASE + result.posterPath : null,
  };
}

export function createSeerr({ baseUrl, apiKey, fetchImpl = fetch }) {
  const base = `${baseUrl.replace(/\/+$/, "")}/api/v1`;
  const headers = { "X-Api-Key": apiKey, Accept: "application/json" };

  async function call(path, options = {}) {
    const res = await fetchImpl(base + path, { ...options, headers: { ...headers, ...options.headers } });
    if (!res.ok) throw new Error(`Seerr answered ${res.status} for ${path.split("?")[0]}`);
    return res.json();
  }

  // Seerr is strict about encoding here. Spaces have to be %20, not a plus sign.
  async function search(term, limit = 10) {
    const data = await call(`/search?query=${encodeURIComponent(term)}&page=1`);
    return (data.results || [])
      .filter((r) => r.mediaType === "movie" || r.mediaType === "tv")
      .slice(0, limit)
      .map(toChoice);
  }

  async function request(choice) {
    const body = { mediaType: choice.mediaType, mediaId: choice.mediaId };
    if (choice.mediaType === "tv") body.seasons = "all";
    const made = await call("/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { id: made.id };
  }

  // The most recent requests that have finished and landed in the library.
  async function available(take = 20) {
    const data = await call(`/request?take=${take}&skip=0&filter=available&sort=modified`);
    return (data.results || [])
      .filter((r) => r.media?.tmdbId)
      .map((r) => ({ id: r.id, mediaType: r.type || r.media.mediaType, mediaId: r.media.tmdbId }));
  }

  async function details(mediaType, mediaId) {
    const data = await call(`/${mediaType === "tv" ? "tv" : "movie"}/${mediaId}`);
    return toChoice({ ...data, mediaType, id: mediaId });
  }

  // For the status report. Returns the version, or throws.
  async function ping() {
    const info = await call("/status");
    return info.version ? `v${info.version}` : "";
  }

  return { search, request, available, details, ping };
}
