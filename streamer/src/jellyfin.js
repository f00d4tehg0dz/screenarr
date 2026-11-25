const TICKS_PER_SECOND = 10_000_000;

const pad = (n) => String(n).padStart(2, "0");

const toItem = (item) => ({
  id: item.Id,
  title: label(item),
  seconds: item.RunTimeTicks ? Math.round(item.RunTimeTicks / TICKS_PER_SECOND) : 0,
  // An episode borrows its show's poster. Episode stills make poor cover art.
  artId: item.SeriesId || item.Id,
});

function label(item) {
  if (item.Type === "Episode") {
    const hasNumbers = item.ParentIndexNumber != null && item.IndexNumber != null;
    const code = hasNumbers ? ` S${pad(item.ParentIndexNumber)}E${pad(item.IndexNumber)}` : "";
    return `${item.SeriesName || "Unknown show"}${code}: ${item.Name}`;
  }
  return item.ProductionYear ? `${item.Name} (${item.ProductionYear})` : item.Name;
}

export function createJellyfin({ baseUrl, apiKey, userId = "", fetchImpl = fetch }) {
  const base = baseUrl.replace(/\/+$/, "");
  // The key rides in a header so it never ends up in a URL or a log line.
  const authHeaders = { Authorization: `MediaBrowser Token="${apiKey}"` };

  async function get(path, params = {}) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetchImpl(url, { headers: { ...authHeaders, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Jellyfin answered ${res.status} for ${path}`);
    return res.json();
  }

  async function items(extra) {
    const params = {
      IncludeItemTypes: "Movie,Episode",
      Recursive: "true",
      Fields: "RunTimeTicks",
      ...extra,
    };
    if (userId) params.userId = userId;
    const data = await get("/Items", params);
    return (data.Items || []).map(toItem);
  }

  // Everything playable in a playlist, collection or library.
  // Playlists have their own endpoint, so try that first.
  async function list(id) {
    try {
      const params = { Fields: "RunTimeTicks" };
      if (userId) params.userId = userId;
      const data = await get(`/Playlists/${encodeURIComponent(id)}/Items`, params);
      return (data.Items || []).filter((item) => item.MediaType !== "Audio").map(toItem);
    } catch {
      return items({ ParentId: id, Limit: 1000 });
    }
  }

  const search = (term, limit = 8) => items({ searchTerm: term, Limit: limit });

  // One random movie or episode. parentId narrows it to a library or collection.
  // Pass types to narrow it further, for example "Movie".
  async function random(parentId = "", types = "") {
    const params = { SortBy: "Random", Limit: 1 };
    if (types) params.IncludeItemTypes = types;
    if (parentId) params.ParentId = parentId;
    const [item] = await items(params);
    return item || null;
  }

  // A public poster URL for an item, or null. Jellyfin already knows where its
  // artwork came from, so ask it for the source link. Discord can fetch that.
  // It could never fetch the copy sitting on this server.
  const posters = new Map();
  async function poster(artId) {
    if (!artId) return null;
    if (posters.has(artId)) return posters.get(artId);
    let url = null;
    try {
      const data = await get(`/Items/${encodeURIComponent(artId)}/RemoteImages`, { type: "Primary", limit: 1 });
      const found = data.Images?.[0]?.Url || "";
      if (found.startsWith("https://")) url = found;
    } catch {
      // No poster is fine. The status just goes out without one.
    }
    if (posters.size > 500) posters.delete(posters.keys().next().value);
    posters.set(artId, url);
    return url;
  }

  // static=true hands back the original file, so the only encode is ours.
  const streamUrl = (id) => `${base}/Videos/${encodeURIComponent(id)}/stream?static=true`;

  // For the status report. Returns the server version, or throws.
  async function ping() {
    const info = await get("/System/Info/Public");
    return info.Version ? `v${info.Version}` : "";
  }

  return { search, random, list, poster, ping, streamUrl, authHeaders };
}
