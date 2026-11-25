// Slash command definitions and the logic behind them.
// No discord.js import in here. It only uses the handful of interaction
// methods it needs, so the tests can hand it a fake.

const STRING = 3;
const EPHEMERAL = 64;

export function slashDefinitions({ hasLibrary, hasLive, lists = [], hasRequests = false }) {
  const defs = [];
  if (hasLibrary) {
    defs.push(
      {
        name: "play",
        description: "Play a movie or episode from the library",
        options: [
          { type: STRING, name: "title", description: "Start typing a title", required: true, autocomplete: true },
        ],
      },
      { name: "random", description: "Play a random movie" },
      {
        name: "shuffle",
        description: "Random movies back to back until you stop it",
        // Discord allows 25 choices at most.
        options: lists.length
          ? [{
              type: STRING,
              name: "list",
              description: "Shuffle one list instead of every movie",
              required: false,
              choices: lists.slice(0, 25).map((name) => ({ name, value: name })),
            }]
          : [],
      },
      {
        name: "search",
        description: "Look something up in the library",
        options: [{ type: STRING, name: "query", description: "What to look for", required: true }],
      },
      {
        name: "seek",
        description: "Jump to a time in the current video",
        options: [{ type: STRING, name: "time", description: "45:00, 1:02:03 or seconds", required: true }],
      },
    );
  }
  if (hasRequests) {
    defs.push({
      name: "request",
      description: "Ask for a movie or show that is not in the library",
      options: [
        { type: STRING, name: "title", description: "Start typing a title", required: true, autocomplete: true },
      ],
    });
  }
  defs.push({ name: "np", description: "Show what is playing" });
  defs.push({ name: "skip", description: "Skip to something else" });
  if (hasLive) defs.push({ name: "live", description: "Go back to the live feed" });
  defs.push({ name: "stop", description: "Stop streaming" });
  return defs;
}

const clip = (text, max = 100) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

export function createSlash({ handle, jellyfin, seerr = null, allowed = () => true, log = console.error }) {
  // Autocomplete hands Discord an item id. Remember what each id was so the
  // command that follows does not need a second trip to Jellyfin.
  const suggested = new Map();
  const remember = (item) => {
    suggested.set(item.id, item);
    if (suggested.size > 500) suggested.delete(suggested.keys().next().value);
  };

  // Same idea for requests, keyed by "movie:123" or "tv:456".
  const offered = new Map();

  async function autocompleteRequest(interaction, typed) {
    if (!seerr || typed.length < 2) return interaction.respond([]);
    try {
      const choices = await seerr.search(typed, 10);
      await interaction.respond(
        choices.map((choice) => {
          const key = `${choice.mediaType}:${choice.mediaId}`;
          offered.set(key, choice);
          if (offered.size > 500) offered.delete(offered.keys().next().value);
          return { name: clip(`${choice.title} [${choice.kind}]`), value: key };
        }),
      );
    } catch (err) {
      log(`Request autocomplete failed: ${err?.message ?? err}`);
      await interaction.respond([]).catch(() => {});
    }
  }

  async function autocomplete(interaction) {
    const typed = String(interaction.options.getFocused() || "").trim();
    if (interaction.commandName === "request") return autocompleteRequest(interaction, typed);
    if (!jellyfin || typed.length < 2) return interaction.respond([]);
    try {
      const items = await jellyfin.search(typed, 10);
      items.forEach(remember);
      await interaction.respond(items.map((item) => ({ name: clip(item.title), value: item.id })));
    } catch (err) {
      log(`Autocomplete failed: ${err?.message ?? err}`);
      await interaction.respond([]).catch(() => {});
    }
  }

  function toCommand(interaction) {
    const name = interaction.commandName;
    if (name === "play") {
      const value = interaction.options.getString("title") || "";
      const item = suggested.get(value);
      return item ? { name, arg: item.title, item } : { name, arg: value };
    }
    if (name === "request") {
      const value = interaction.options.getString("title") || "";
      const pick = offered.get(value);
      const userId = interaction.user?.id || "";
      return pick ? { name, arg: pick.title, pick, userId } : { name, arg: value, userId };
    }
    if (name === "search") return { name, arg: interaction.options.getString("query") || "" };
    if (name === "seek") return { name, arg: interaction.options.getString("time") || "" };
    if (name === "shuffle") return { name, arg: interaction.options.getString("list") || "" };
    return { name, arg: "" };
  }

  async function run(interaction) {
    if (!allowed(interaction)) {
      return interaction.reply({ content: "You are not on the list for this one.", flags: EPHEMERAL });
    }
    // Search results are only useful to the person who asked.
    const quiet = interaction.commandName === "search";
    await interaction.deferReply(quiet ? { flags: EPHEMERAL } : {});
    try {
      const reply = await handle(toCommand(interaction));
      await interaction.editReply(reply || "Nothing to do.");
    } catch (err) {
      log(`/${interaction.commandName} failed: ${err?.message ?? err}`);
      await interaction.editReply("That did not work. Check the container logs.").catch(() => {});
    }
  }

  return async function onInteraction(interaction) {
    if (interaction.isAutocomplete()) return autocomplete(interaction);
    if (interaction.isChatInputCommand()) return run(interaction);
  };
}
