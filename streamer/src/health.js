import { formatTime } from "./commands.js";

// Keeps the last few errors and builds the /status report, so finding out what
// is wrong does not need a trip to the container logs.

export function createHealth({ now = Date.now, keep = 5 } = {}) {
  const startedAt = now();
  const errors = [];

  return {
    startedAt,
    error(text) {
      // Only the last line. ffmpeg errors come with a page of noise above it.
      const line = String(text).trim().split("\n").pop().slice(0, 300);
      errors.unshift({ at: now(), text: line });
      errors.length = Math.min(errors.length, keep);
    },
    errors: () => errors.map((e) => ({ ...e })),
    uptime: () => Math.floor((now() - startedAt) / 1000),
  };
}

export function ago(seconds) {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

// A check that takes too long counts as failed. A status command that hangs
// on a dead server is no use to anyone.
async function probe(check, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("no answer")), timeoutMs);
  });
  try {
    const detail = await Promise.race([check(), timeout]);
    return `ok${detail ? ` (${detail})` : ""}`;
  } catch (err) {
    return `DOWN: ${String(err?.message ?? err).split("\n")[0].slice(0, 120)}`;
  } finally {
    clearTimeout(timer);
  }
}

export function createStatus({
  health,
  player,
  services = [],
  accounts = () => [],
  listeners = () => [],
  hasLive = true,
  timeoutMs = 4000,
  now = Date.now,
}) {
  return async function status() {
    const info = player.info();
    const playing = player.now();

    let screen = "nothing";
    if (playing?.type === "live") screen = "the live feed";
    else if (playing) screen = `${playing.item.title} at ${formatTime(playing.position)}`;

    const mode = info.mode === "shuffle" && info.list ? `shuffle (${info.list})` : info.mode;
    const checks = await Promise.all(services.map((s) => probe(s.check, timeoutMs)));

    const lines = [
      `Up ${ago(health.uptime())}`,
      `On screen: ${screen}`,
      `Mode: ${mode}, ${info.queued} queued`,
    ];
    if (hasLive) lines.push(`Live feed: ${info.liveUp ? "up" : "down"}`);
    services.forEach((s, i) => lines.push(`${s.name}: ${checks[i]}`));
    for (const account of accounts()) lines.push(`${account.label}: ${account.name || "not connected"}`);
    lines.push(`In the voice channel: ${listeners().length}`);

    const errors = health.errors();
    if (!errors.length) {
      lines.push("No errors since start.");
    } else {
      lines.push("Last errors:");
      for (const e of errors) lines.push(`  ${ago((now() - e.at) / 1000)} ago: ${e.text}`);
    }
    return lines.join("\n");
  };
}
