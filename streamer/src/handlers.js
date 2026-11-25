import { parseTime, formatTime } from "./commands.js";

// Turns a parsed command into an action plus the text to send back.
// Nothing in here touches Discord, which keeps it easy to test.
//
// A command arrives as { name, arg } plus who sent it: userId, and admin when
// they are on the admin list.

export function createHandlers({
  jellyfin,
  player,
  prefix = "!",
  hasLive = true,
  libraryId = "",
  lists = [],
  requests = null,
  status = null,
  listeners = () => [],
  skipRatio = 0.5,
  queueMax = 50,
  hasAdmins = false,
}) {
  let lastResults = [];
  // Skip votes for whatever is playing right now.
  let ballot = { key: "", voters: new Set() };

  const help = () =>
    [
      `${prefix}search <title>   look something up in the library`,
      `${prefix}play <number>    play a result from the last search`,
      `${prefix}play <title>     play the best match, or queue it if something is on`,
      `${prefix}random           play a random movie`,
      `${prefix}shuffle          random movies back to back until you stop it`,
      lists.length ? `${prefix}shuffle <list>   same, from a list: ${lists.join(", ")}` : null,
      `${prefix}queue            see what is lined up`,
      `${prefix}queue remove <n> take something out of the line`,
      `${prefix}queue clear      empty the line`,
      `${prefix}seek <time>      jump to 45:00, 1:02:03 or a number of seconds`,
      `${prefix}np               what is playing right now`,
      `${prefix}skip             skip, or vote to skip someone else's pick`,
      requests ? `${prefix}request <title>  ask for something that is not in the library` : null,
      hasLive ? `${prefix}live             go back to the live feed` : null,
      `${prefix}stop             stop streaming`,
      status ? `${prefix}status           how things are running` : null,
    ].filter(Boolean).join("\n");

  const length = (item) => (item.seconds ? ` [${formatTime(item.seconds)}]` : "");
  const line = (item, i) => `${i + 1}. ${item.title}${length(item)}`;
  const who = (id) => (id ? ` (<@${id}>)` : "");
  const cleared = (count) => (count ? ` Cleared ${count} from the queue.` : "");

  async function search(arg) {
    if (!arg) return `Search for what? Try ${prefix}search alien`;
    lastResults = await jellyfin.search(arg);
    if (!lastResults.length) return `Nothing in the library matches "${arg}".`;
    return `${lastResults.map(line).join("\n")}\nPick one with ${prefix}play <number>`;
  }

  // Starts the item, or puts it in line when someone's pick is already on.
  function start(item, userId) {
    if (player.info().mode === "item" && player.queue().length >= queueMax) {
      return `The queue is full at ${queueMax}. Try again after a few have played.`;
    }
    const place = player.request(item, userId);
    return place ? `Queued ${item.title}. Number ${place} in line.` : `Playing ${item.title}`;
  }

  async function play(arg, picked, userId) {
    if (!arg && !picked) return `Play what? Use ${prefix}play <number> or ${prefix}play <title>`;

    let item;
    if (picked) {
      item = picked;
    } else if (/^\d+$/.test(arg) && lastResults.length) {
      item = lastResults[Number(arg) - 1];
      if (!item) return `The last search only had ${lastResults.length} results.`;
    } else {
      const results = await jellyfin.search(arg, 1);
      item = results[0];
      if (!item) return `Nothing in the library matches "${arg}".`;
    }
    return start(item, userId);
  }

  async function random(userId) {
    const item = await jellyfin.random(libraryId, "Movie");
    if (!item) return "The library has no movies to pick from.";
    return start(item, userId);
  }

  function seek(arg) {
    const now = player.now();
    if (!now || now.type !== "item") return "Seeking only works on library videos.";
    const seconds = parseTime(arg);
    if (seconds === null) return `That is not a time. Try ${prefix}seek 45:00`;
    if (now.item.seconds && seconds >= now.item.seconds) {
      return `That is past the end. It runs ${formatTime(now.item.seconds)}.`;
    }
    player.playItem(now.item, seconds, now.by || "");
    return `Jumping to ${formatTime(seconds)}`;
  }

  function nowPlaying() {
    const now = player.now();
    if (!now) return "Nothing is playing.";
    if (now.type === "live") return "The live feed is on.";
    const total = now.item.seconds ? ` of ${formatTime(now.item.seconds)}` : "";
    const waiting = player.queue().length;
    return `${now.item.title}, ${formatTime(now.position)}${total}${waiting ? `. ${waiting} queued.` : ""}`;
  }

  function showQueue() {
    const now = player.now();
    const entries = player.queue();
    if (!entries.length) {
      return now?.type === "item" && !now.filler
        ? `Now: ${now.item.title}${who(now.by)}\nNothing else is lined up.`
        : "The queue is empty.";
    }
    const lines = entries.map((e, i) => `${line(e.item, i)}${who(e.by)}`);
    if (now?.type === "item") lines.unshift(`Now: ${now.item.title}${who(now.by)}`);
    return lines.join("\n");
  }

  function removeFromQueue(text, userId, admin) {
    const entries = player.queue();
    const index = Number(text) - 1;
    if (!/^\d+$/.test(text) || !entries[index]) {
      return entries.length
        ? `Pick a number from 1 to ${entries.length}.`
        : "The queue is empty.";
    }
    // With no admin list anyone may tidy the queue. With one, it is yours or it is not.
    if (hasAdmins && !admin && entries[index].by !== userId) {
      return "You can only remove your own picks.";
    }
    const removed = player.removeAt(index);
    return `Removed ${removed.item.title}.`;
  }

  function clearQueue(admin) {
    if (hasAdmins && !admin) return "Only an admin can clear the queue.";
    const count = player.clearQueue();
    return count ? `Cleared ${count} from the queue.` : "The queue is already empty.";
  }

  function queue(arg, userId, admin) {
    const [action = "", value = ""] = arg.trim().toLowerCase().split(/\s+/);
    if (!action || action === "list" || action === "show") return showQueue();
    if (action === "remove") return removeFromQueue(value, userId, admin);
    if (action === "clear") return clearQueue(admin);
    return `Try ${prefix}queue, ${prefix}queue remove <number> or ${prefix}queue clear`;
  }

  function skip(userId, admin) {
    const now = player.now();
    if (!now) return "Nothing is playing.";

    // Nobody chose the live feed or a shuffle pick, so nobody needs asking.
    const chosen = now.type === "item" && !now.filler;
    if (!chosen || admin || !userId || now.by === userId) {
      player.skip();
      return "Skipping.";
    }

    const present = listeners();
    // If the voice channel cannot be read, do not lock everyone out of skip.
    if (!present.length) {
      player.skip();
      return "Skipping.";
    }
    if (!present.includes(userId)) return "Join the voice channel to vote.";

    const key = `${now.item.id}:${now.startedAt}`;
    if (ballot.key !== key) ballot = { key, voters: new Set() };
    ballot.voters.add(userId);

    // Votes from people who have since left do not count.
    const votes = [...ballot.voters].filter((id) => present.includes(id)).length;
    const needed = Math.min(present.length, Math.floor(present.length * skipRatio) + 1);
    if (votes >= needed) {
      player.skip();
      return `Vote passed with ${votes} of ${present.length}. Skipping.`;
    }
    return `Skip vote ${votes} of ${needed} needed.`;
  }

  return async function handle({ name, arg = "", item, pick, userId = "", admin = false }) {
    switch (name) {
      case "help":
        return help();
      case "search":
      case "find":
        return jellyfin ? search(arg) : "No library is hooked up.";
      case "play":
        return jellyfin ? play(arg, item, userId) : "No library is hooked up.";
      case "random":
        return jellyfin ? random(userId) : "No library is hooked up.";
      case "request":
        if (!requests) return "Requests are not set up.";
        return requests.submit({ query: arg, pick, userId });
      case "queue":
      case "q":
        return queue(arg, userId, admin);
      case "seek":
        return seek(arg);
      case "np":
      case "now":
        return nowPlaying();
      case "shuffle": {
        if (!jellyfin) return "No library is hooked up.";
        const list = arg.trim().toLowerCase();
        if (list && !lists.includes(list)) {
          return lists.length
            ? `There is no list called ${list}. Try one of: ${lists.join(", ")}`
            : "No lists are set up. Plain shuffle still works.";
        }
        const what = list ? `The ${list} list is` : "Shuffle is";
        if (player.isShuffling(list)) return `${what} already on. ${prefix}skip for the next one, ${prefix}stop to end it.`;
        const dropped = player.queue().length;
        player.shuffle(list);
        return `${what} on. It plays back to back until ${prefix}stop${hasLive ? ` or ${prefix}live` : ""}.${cleared(dropped)}`;
      }
      case "skip":
      case "next":
        return skip(userId, admin);
      case "live": {
        if (!hasLive) return "There is no live feed configured.";
        const dropped = player.queue().length;
        player.auto();
        return `Back to the live feed. The library fills in whenever it is down.${cleared(dropped)}`;
      }
      case "stop": {
        const dropped = player.queue().length;
        player.stop();
        return `Stopped.${cleared(dropped)}`;
      }
      case "status":
        if (!status) return null;
        if (hasAdmins && !admin) return "Only an admin can see the status.";
        return status();
      default:
        return null;
    }
  };
}
