import { ActivityType, Client, Events, GatewayIntentBits } from "discord.js";
import { slashDefinitions, createSlash } from "./slash.js";
import { botPresence, channelCard } from "./presence.js";

// The real bot. It owns the slash commands and nothing else.
// Video still goes out through the user account, because bots cannot send it.

export async function startBot({
  token,
  guildId,
  clearGlobal,
  handle,
  jellyfin,
  allowed,
  hasLive,
  lists,
  cardChannelId,
  seerr,
}) {
  const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
  const definitions = slashDefinitions({
    hasLibrary: Boolean(jellyfin),
    hasLive,
    lists,
    hasRequests: Boolean(seerr),
  });

  bot.once(Events.ClientReady, async () => {
    try {
      // Guild commands show up right away. Global ones can take an hour.
      await bot.application.commands.set(definitions, guildId);
      if (clearGlobal) await bot.application.commands.set([]);
      console.log(`Bot ${bot.user.tag} registered ${definitions.length} slash commands`);
    } catch (err) {
      console.error(`Could not register slash commands: ${err?.message ?? err}`);
    }
  });

  bot.on(Events.InteractionCreate, createSlash({ handle, jellyfin, seerr, allowed }));
  await bot.login(token);
  const setStatus = botPresence(bot, ActivityType.Watching);
  const setCard = cardChannelId ? channelCard(bot, cardChannelId) : null;
  return {
    bot,
    // Posts a message payload in a channel. Used for "your request is ready".
    async post(channelId, payload) {
      const channel = await bot.channels.fetch(channelId);
      await channel.send(payload);
    },
    setNowPlaying(info) {
      setStatus(info);
      if (setCard) setCard(info);
    },
  };
}
