export function parseCommand(text, prefix = "!") {
  if (typeof text !== "string" || !text.startsWith(prefix)) return null;
  const body = text.slice(prefix.length).trim();
  if (!body) return null;
  const space = body.search(/\s/);
  const name = (space === -1 ? body : body.slice(0, space)).toLowerCase();
  const arg = space === -1 ? "" : body.slice(space + 1).trim();
  return { name, arg };
}

// Accepts 90, 45:00 or 1:02:03. Returns seconds, or null if it is not a time.
export function parseTime(text) {
  if (!/^\d+(:\d{1,2}){0,2}$/.test(text)) return null;
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const two = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
