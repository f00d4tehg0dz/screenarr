// Slash command definitions and the logic behind them.
// No discord.js import in here. It only uses the handful of interaction
// methods it needs, so the tests can hand it a fake.

const SUBCOMMAND = 1;
const STRING = 3;
const INTEGER = 4;
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
  if (hasLibrary) {
    defs.push({
      name: "queue",
      description: "See or change what is lined up",
      options: [
        { type: SUBCOMMAND, name: "show", description: "See what is lined up" },
        {
          type: SUBCOMMAND,
          name: "remove",
          description: "Take something out of the line",
          options: [
            { type: INTEGER, name: "position", description: "Its number in the queue", required: true, min_value: 1 },
          ],
        },
        { type: SUBCOMMAND, name: "clear", description: "Empty the line" },
      ],
    });
  }
  defs.push({ name: "np", description: "Show what is playing" });
  defs.push({ name: "skip", description: "Skip, or vote to skip someone else's pick" });
  if (hasLive) defs.push({ name: "live", description: "Go back to the live feed" });
  defs.push({ name: "stop", description: "Stop streaming" });
  // Hidden from everyone but server admins unless you change it in
  // Server Settings, Integrations.
  defs.push({ name: "status", description: "How things are running", default_member_permissions: "0" });
  return defs;
}

const clip = (text, max = 100) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

export function createSlash({
  handle,
  jellyfin,
  seerr = null,
  allowed = () => true,
  isAdmin = () => false,
  log = console.error,
}) {
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
    const sender = { userId: interaction.user?.id || "", admin: Boolean(isAdmin(interaction)) };
    return { ...describeCommand(interaction), ...sender };
  }

  function describeCommand(interaction) {
    const name = interaction.commandName;
    if (name === "play") {
      const value = interaction.options.getString("title") || "";
      const item = suggested.get(value);
      return item ? { name, arg: item.title, item } : { name, arg: value };
    }
    if (name === "request") {
      const value = interaction.options.getString("title") || "";
      const pick = offered.get(value);
      return pick ? { name, arg: pick.title, pick } : { name, arg: value };
    }
    if (name === "queue") {
      const action = interaction.options.getSubcommand();
      if (action === "remove") return { name, arg: `remove ${interaction.options.getInteger("position")}` };
      return { name, arg: action === "clear" ? "clear" : "" };
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
    // Search results and the status report are only for the person who asked.
    const quiet = interaction.commandName === "search" || interaction.commandName === "status";
    await interaction.deferReply(quiet ? { flags: EPHEMERAL } : {});
    try {
      const reply = await handle(toCommand(interaction));
      // Replies name people, for example in the queue. Naming is not pinging.
      await interaction.editReply({ content: reply || "Nothing to do.", allowedMentions: { parse: [] } });
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
