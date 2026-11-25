const env = process.env;

const list = (v) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);
const flag = (v) => v === "1" || v === "true";

// "christmas:abc123,horror:def456" becomes { christmas: "abc123", horror: "def456" }
export function parseLists(v) {
  const lists = {};
  for (const pair of list(v)) {
    const cut = pair.indexOf(":");
    if (cut < 1) continue;
    const name = pair.slice(0, cut).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const id = pair.slice(cut + 1).trim();
    if (name && id) lists[name] = id;
  }
  return lists;
}

export const config = {
  token: env.DISCORD_TOKEN,
  guildId: env.GUILD_ID,
  voiceChannelId: env.VOICE_CHANNEL_ID,
  commandChannelId: env.COMMAND_CHANNEL_ID,
  prefix: env.COMMAND_PREFIX || "!",
  allowedUsers: list(env.ALLOWED_USER_IDS),
  allowedRoles: list(env.ALLOWED_ROLE_IDS),
  adminUsers: list(env.ADMIN_USER_IDS),
  adminRoles: list(env.ADMIN_ROLE_IDS),
  skipVoteRatio: Number(env.SKIP_VOTE_RATIO || 0.5),
  queueMax: Number(env.QUEUE_MAX || 50),

  botToken: env.BOT_TOKEN || "",
  botClearGlobal: flag(env.BOT_CLEAR_GLOBAL_COMMANDS),

  liveTitle: env.LIVE_TITLE || "Live stream",
  accountPresence: flag(env.ACCOUNT_PRESENCE),
  accountPresenceAppId: env.ACCOUNT_PRESENCE_APP_ID || "",
  nowPlayingChannelId: env.NOW_PLAYING_CHANNEL_ID || "",

  seerrUrl: env.SEERR_URL || "",
  seerrKey: env.SEERR_API_KEY || "",
  requestsChannelId: env.REQUESTS_CHANNEL_ID || "",
  requestPollSeconds: Number(env.REQUEST_POLL_SECONDS || 60),

  liveUrl: env.LIVE_URL || "",
  pollSeconds: Number(env.POLL_SECONDS || 5),

  jellyfinUrl: env.JELLYFIN_URL || "",
  jellyfinKey: env.JELLYFIN_API_KEY || "",
  jellyfinUserId: env.JELLYFIN_USER_ID || "",
  idleShuffle: flag(env.IDLE_SHUFFLE),
  idleLibraryId: env.IDLE_LIBRARY_ID || "",
  shuffleLists: parseLists(env.SHUFFLE_LISTS),
  idleList: (env.IDLE_LIST || "").trim().toLowerCase(),

  height: Number(env.HEIGHT || 720),
  liveFps: Number(env.LIVE_FPS || 30),
  bitrate: Number(env.BITRATE || 4000),
  preset: env.X264_PRESET || "superfast",
  noTranscodeLive: flag(env.NO_TRANSCODE_LIVE),
  minimizeLatency: flag(env.MINIMIZE_LATENCY),
};

export function checkConfig(c) {
  const missing = [];
  if (!c.token) missing.push("DISCORD_TOKEN");
  if (!c.guildId) missing.push("GUILD_ID");
  if (!c.voiceChannelId) missing.push("VOICE_CHANNEL_ID");
  if (!c.liveUrl && !c.jellyfinUrl) missing.push("LIVE_URL or JELLYFIN_URL");
  if (c.jellyfinUrl && !c.jellyfinKey) missing.push("JELLYFIN_API_KEY");
  if (c.seerrUrl && !c.seerrKey) missing.push("SEERR_API_KEY");
  if (c.idleList && !c.shuffleLists[c.idleList]) missing.push(`a SHUFFLE_LISTS entry named ${c.idleList}`);
  if (c.jellyfinUrl && !c.commandChannelId && !c.botToken) {
    missing.push("BOT_TOKEN or COMMAND_CHANNEL_ID");
  }
  return missing;
}
