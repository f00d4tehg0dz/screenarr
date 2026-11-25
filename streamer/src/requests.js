import { STATUS } from "./seerr.js";

// Takes requests for things that are not in the library yet, and says so in a
// channel when they arrive.
//
// It does not keep a file. On startup it looks at what Seerr already lists as
// finished and treats that as old news. Anything that shows up after that gets
// announced, whoever asked for it and wherever they asked.

export function createRequests({ seerr, announce = null, prefix = "/", log = console.error }) {
  const askedBy = new Map();
  const seen = new Set();
  let primed = false;

  async function submit({ query = "", pick = null, userId = "" }) {
    let choice = pick;
    if (!choice) {
      if (!query) return `Request what? Try ${prefix}request and a title.`;
      [choice] = await seerr.search(query, 1);
      if (!choice) return `Nothing called "${query}" turned up.`;
    }

    if (choice.status === STATUS.AVAILABLE) {
      return `${choice.title} is already in the library. Use ${prefix}play.`;
    }
    if (choice.status === STATUS.PENDING || choice.status === STATUS.PROCESSING) {
      return `${choice.title} has already been requested. It is on the way.`;
    }

    const made = await seerr.request(choice);
    if (userId && made.id != null) askedBy.set(made.id, userId);
    return announce
      ? `Requested ${choice.title}. I will post when it is ready.`
      : `Requested ${choice.title}.`;
  }

  async function poll() {
    if (!announce) return;
    let finished;
    try {
      finished = await seerr.available();
    } catch (err) {
      log(`Could not check on requests: ${err?.message ?? err}`);
      return;
    }

    if (!primed) {
      for (const r of finished) seen.add(r.id);
      primed = true;
      return;
    }

    for (const r of finished) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      try {
        const info = await seerr.details(r.mediaType, r.mediaId);
        await announce(readyMessage({ ...info, userId: askedBy.get(r.id) || "", prefix }));
      } catch (err) {
        log(`Could not announce a finished request: ${err?.message ?? err}`);
      }
      askedBy.delete(r.id);
    }
    if (seen.size > 2000) for (const id of [...seen].slice(0, 1000)) seen.delete(id);
  }

  return { submit, poll };
}

// The "it is here" post. A plain message payload with an embed.
export function readyMessage({ title, kind = "Movie", poster = null, userId = "", prefix = "/" }) {
  const embed = {
    title: `${title} is ready`,
    description: `${kind} added to the library. ${prefix}play to watch it.`,
    color: 0x22c55e,
  };
  if (poster) embed.thumbnail = { url: poster };
  const message = { embeds: [embed] };
  if (userId) message.content = `<@${userId}> your request is in.`;
  return message;
}
