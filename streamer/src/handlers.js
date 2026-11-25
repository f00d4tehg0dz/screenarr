import { parseTime, formatTime } from "./commands.js";

// Turns a parsed command into an action plus the text to send back.
// Nothing in here touches Discord, which keeps it easy to test.

export function createHandlers({
  jellyfin,
  player,
  prefix = "!",
  hasLive = true,
  libraryId = "",
  lists = [],
  requests = null,
}) {
  let lastResults = [];

  const help = () =>
    [
      `${prefix}search <title>   look something up in the library`,
      `${prefix}play <number>    play a result from the last search`,
      `${prefix}play <title>     play the best match for a title`,
      `${prefix}random           play a random movie`,
      `${prefix}shuffle          random movies back to back until you stop it`,
      lists.length ? `${prefix}shuffle <list>   same, from a list: ${lists.join(", ")}` : null,
      `${prefix}seek <time>      jump to 45:00, 1:02:03 or a number of seconds`,
      `${prefix}np               what is playing right now`,
      `${prefix}skip             skip to something else`,
      requests ? `${prefix}request <title>  ask for something that is not in the library` : null,
      hasLive ? `${prefix}live             go back to the live feed` : null,
      `${prefix}stop             stop streaming`,
    ].filter(Boolean).join("\n");

  const line = (item, i) =>
    `${i + 1}. ${item.title}${item.seconds ? ` [${formatTime(item.seconds)}]` : ""}`;

  async function search(arg) {
    if (!arg) return `Search for what? Try ${prefix}search alien`;
    lastResults = await jellyfin.search(arg);
    if (!lastResults.length) return `Nothing in the library matches "${arg}".`;
    return `${lastResults.map(line).join("\n")}\nPick one with ${prefix}play <number>`;
  }

  async function play(arg, picked) {
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

    player.playItem(item);
    return `Playing ${item.title}`;
  }

  async function random() {
    const item = await jellyfin.random(libraryId, "Movie");
    if (!item) return "The library has no movies to pick from.";
    player.playItem(item);
    return `Playing ${item.title}`;
  }

  function seek(arg) {
    const now = player.now();
    if (!now || now.type !== "item") return "Seeking only works on library videos.";
    const seconds = parseTime(arg);
    if (seconds === null) return `That is not a time. Try ${prefix}seek 45:00`;
    if (now.item.seconds && seconds >= now.item.seconds) {
      return `That is past the end. It runs ${formatTime(now.item.seconds)}.`;
    }
    player.playItem(now.item, seconds);
    return `Jumping to ${formatTime(seconds)}`;
  }

  function nowPlaying() {
    const now = player.now();
    if (!now) return "Nothing is playing.";
    if (now.type === "live") return "The live feed is on.";
    const total = now.item.seconds ? ` of ${formatTime(now.item.seconds)}` : "";
    return `${now.item.title}, ${formatTime(now.position)}${total}`;
  }

  return async function handle({ name, arg, item, pick, userId }) {
    switch (name) {
      case "help":
        return help();
      case "search":
      case "find":
        return jellyfin ? search(arg) : "No library is hooked up.";
      case "play":
        return jellyfin ? play(arg, item) : "No library is hooked up.";
      case "random":
        return jellyfin ? random() : "No library is hooked up.";
      case "request":
        if (!requests) return "Requests are not set up.";
        return requests.submit({ query: arg, pick, userId });
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
        player.shuffle(list);
        return `${what} on. It plays back to back until ${prefix}stop${hasLive ? ` or ${prefix}live` : ""}.`;
      }
      case "skip":
      case "next":
        if (!player.now()) return "Nothing is playing.";
        player.skip();
        return "Skipping.";
      case "live":
        if (!hasLive) return "There is no live feed configured.";
        player.auto();
        return "Back to the live feed. The library fills in whenever it is down.";
      case "stop":
        player.stop();
        return "Stopped.";
      default:
        return null;
    }
  };
}
