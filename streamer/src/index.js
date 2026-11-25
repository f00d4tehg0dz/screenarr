import { execFile } from "node:child_process";
import { Client } from "@lng2004/discord.js-selfbot-v13";
import {
  Streamer,
  prepareStream,
  playStream,
  Utils,
  Encoders,
} from "@dank074/discord-video-stream";

import { config, checkConfig } from "./config.js";
import { createJellyfin } from "./jellyfin.js";
import { createPlayer } from "./player.js";
import { createHandlers } from "./handlers.js";
import { parseCommand } from "./commands.js";
import { describe, accountPresence, debounced } from "./presence.js";
import { createBag } from "./bag.js";
import { createSeerr } from "./seerr.js";
import { createRequests } from "./requests.js";

const missing = checkConfig(config);
if (missing.length) {
  console.error(`Missing settings: ${missing.join(", ")}`);
  process.exit(1);
}

const jellyfin = config.jellyfinUrl
  ? createJellyfin({
      baseUrl: config.jellyfinUrl,
      apiKey: config.jellyfinKey,
      userId: config.jellyfinUserId,
    })
  : null;

const seerr = config.seerrUrl ? createSeerr({ baseUrl: config.seerrUrl, apiKey: config.seerrKey }) : null;

// The bot is not logged in yet, so announcements go through this until it is.
let postToChannel = null;
const canAnnounce = Boolean(seerr && config.botToken && config.requestsChannelId);
const requests = seerr
  ? createRequests({
      seerr,
      prefix: config.commandChannelId ? config.prefix : "/",
      announce: canAnnounce
        ? (payload) => postToChannel?.(config.requestsChannelId, payload)
        : null,
    })
  : null;

const streamer = new Streamer(new Client());
const client = streamer.client;

// Only true when the source is up and actually has a video track.
function probeLive() {
  return new Promise((resolve) => {
    const args = ["-v", "error"];
    if (config.liveUrl.startsWith("rtsp")) args.push("-rtsp_transport", "tcp");
    args.push(
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name",
      "-of", "csv=p=0",
      config.liveUrl,
    );
    execFile("ffprobe", args, { timeout: 8000 }, (err, stdout) => {
      resolve(!err && stdout.trim().length > 0);
    });
  });
}

async function play(target, signal) {
  const isLive = target.type === "live";
  const url = isLive ? config.liveUrl : jellyfin.streamUrl(target.item.id);
  const start = target.startSeconds || 0;

  const inputOptions = [];
  if (url.startsWith("rtsp")) inputOptions.push("-rtsp_transport", "tcp");
  if (start > 0) inputOptions.push("-ss", String(start));

  const options = {
    noTranscoding: isLive && config.noTranscodeLive,
    encoder: Encoders.software({ x264: { preset: config.preset } }),
    height: config.height,
    bitrateVideo: config.bitrate,
    bitrateVideoMax: Math.round(config.bitrate * 1.5),
    videoCodec: Utils.normalizeVideoCodec("H264"),
    minimizeLatency: isLive && config.minimizeLatency,
    // Releases that shell out to ffmpeg seek with -ss. Newer ones use startPosition.
    startPosition: start,
    customInputOptions: inputOptions,
  };
  // Movies keep their own frame rate. Forcing 24p up to 30 makes pans stutter.
  if (isLive) {
    options.frameRate = config.liveFps;
    options.fps = config.liveFps;
  } else {
    options.customHeaders = jellyfin.authHeaders;
  }

  const { output, promise } = await prepareStream(url, options, signal);
  promise.catch(() => {});
  await playStream(output, streamer, { type: "go-live" }, signal);
}

// Filled in once the clients are logged in. Until then status updates go nowhere.
const statusTargets = [];
let statusVersion = 0;
const updateStatus = debounced(async (now) => {
  const version = ++statusVersion;
  const info = describe(now, config.liveTitle);
  if (info && jellyfin && now.type === "item") {
    info.image = await jellyfin.poster(now.item.artId);
    // Something else may have started while the poster was being looked up.
    if (version !== statusVersion) return;
  }
  for (const set of statusTargets) set(info);
});

// One bag per named list, so each list remembers what it has already played.
const listNames = jellyfin ? Object.keys(config.shuffleLists) : [];
const bags = Object.fromEntries(
  listNames.map((name) => [name, createBag({ load: () => jellyfin.list(config.shuffleLists[name]) })]),
);

function pickIdle() {
  if (config.idleList) return bags[config.idleList].next();
  return jellyfin.random(config.idleLibraryId);
}

const player = createPlayer({
  play,
  probeLive,
  onChange: updateStatus,
  hasLive: Boolean(config.liveUrl),
  pickIdle: jellyfin && (config.idleShuffle || config.idleList) ? pickIdle : null,
  pickShuffle: jellyfin
    ? (list) => (list ? bags[list].next() : jellyfin.random(config.idleLibraryId, "Movie"))
    : null,
  pollMs: config.pollSeconds * 1000,
});

const handle = createHandlers({
  jellyfin,
  player,
  // Hints in replies should match how people are actually typing commands.
  prefix: config.commandChannelId ? config.prefix : "/",
  libraryId: config.idleLibraryId,
  lists: listNames,
  requests,
  hasLive: Boolean(config.liveUrl),
});

// Works for a chat message (author) and for a slash command (user).
function allowed(source) {
  if (!config.allowedUsers.length && !config.allowedRoles.length) return true;
  const userId = source.author?.id ?? source.user?.id;
  if (config.allowedUsers.includes(userId)) return true;
  return config.allowedRoles.some((id) => source.member?.roles?.cache?.has(id));
}

client.on("messageCreate", async (msg) => {
  if (!config.commandChannelId || msg.channelId !== config.commandChannelId) return;
  if (msg.author.bot || msg.author.id === client.user.id) return;

  const command = parseCommand(msg.content, config.prefix);
  if (!command || !allowed(msg)) return;

  try {
    const reply = await handle({ ...command, userId: msg.author.id });
    if (reply) await msg.channel.send(reply);
  } catch (err) {
    console.error(`Command ${command.name} failed: ${err?.message ?? err}`);
    await msg.channel.send("That did not work. Check the container logs.").catch(() => {});
  }
});

const ready = new Promise((resolve) => client.once("ready", resolve));
await client.login(config.token);
await ready;
console.log(`Logged in as ${client.user?.tag}`);

await streamer.joinVoice(config.guildId, config.voiceChannelId);
console.log("Joined the voice channel");

if (config.accountPresence) {
  const selfbot = await import("@lng2004/discord.js-selfbot-v13");
  const RichPresence = selfbot.RichPresence ?? selfbot.default?.RichPresence ?? null;
  statusTargets.push(accountPresence(client, RichPresence, config.accountPresenceAppId));
}

if (config.botToken) {
  const { startBot } = await import("./bot.js");
  const { setNowPlaying, post } = await startBot({
    token: config.botToken,
    guildId: config.guildId,
    clearGlobal: config.botClearGlobal,
    handle,
    jellyfin,
    allowed,
    hasLive: Boolean(config.liveUrl),
    lists: listNames,
    cardChannelId: config.nowPlayingChannelId,
    seerr,
  });
  statusTargets.push(setNowPlaying);

  if (canAnnounce) {
    postToChannel = post;
    await requests.poll();
    setInterval(() => requests.poll(), config.requestPollSeconds * 1000);
  }
}

await player.run();
