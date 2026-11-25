// "Now playing" as a Discord status, for the bot and for the streaming account.
// A status that fails to update must never get in the way of playback, so
// everything in here swallows its own errors.

// Boils the player state down to what a status needs. Pure, so it is testable.
export function describe(now, liveTitle = "Live stream") {
  if (!now) return null;
  if (now.type === "live") return { name: liveTitle, state: "Live", start: now.startedAt };

  const start = now.startedAt - (now.startSeconds || 0) * 1000;
  const info = { name: now.item.title, state: now.filler ? "Shuffle" : "Requested", start };
  if (now.item.seconds) info.end = start + now.item.seconds * 1000;
  return info;
}

// The bot can only show a line of text: "Watching <title>".
export function botPresence(bot, watchingType) {
  return (info) => {
    try {
      if (info) bot.user.setActivity(info.name, { type: watchingType });
      else bot.user.setPresence({ activities: [] });
    } catch (err) {
      console.error(`Bot status failed: ${err?.message ?? err}`);
    }
  };
}

// The "now playing" card the bot keeps in a text channel. A plain embed object,
// so there is nothing Discord specific to import here.
export function cardFor(info) {
  if (!info) return { title: "Nothing is playing", color: 0x4b5563 };

  const lines = [info.state];
  if (info.start) lines.push(`Started <t:${Math.floor(info.start / 1000)}:R>`);
  if (info.end) lines.push(`Ends <t:${Math.floor(info.end / 1000)}:t>`);
  const card = { title: info.name, description: lines.join("\n"), color: 0xff3d9a, footer: { text: "Now playing" } };
  if (info.image) card.thumbnail = { url: info.image };
  return card;
}

// Keeps one card in a channel and edits it in place, so the channel does not
// fill up with a new message for every video.
export function channelCard(bot, channelId) {
  let message = null;
  let warned = false;

  async function find(channel) {
    const recent = await channel.messages.fetch({ limit: 20 });
    return recent.find((m) => m.author.id === bot.user.id && m.embeds.length > 0) || null;
  }

  return async (info) => {
    try {
      const embeds = [cardFor(info)];
      if (!message) {
        const channel = await bot.channels.fetch(channelId);
        message = await find(channel);
        if (!message) {
          message = await channel.send({ embeds });
          return;
        }
      }
      await message.edit({ embeds });
    } catch (err) {
      message = null;
      if (!warned) console.error(`Now playing card failed: ${err?.message ?? err}`);
      warned = true;
    }
  };
}

// The user account gets the fuller card with a state line, a progress bar and
// the poster. Discord only takes outside images for an application, so the
// poster needs an application id. Without one the card goes out with no art.
export function accountPresence(client, RichPresence, appId = "") {
  let warned = false;
  return async (info) => {
    try {
      if (!info) return void client.user.setPresence({ activities: [] });

      if (!RichPresence) return void client.user.setActivity(info.name, { type: "WATCHING" });

      const card = new RichPresence(client).setType("WATCHING").setName(info.name).setState(info.state);
      if (appId) card.setApplicationId(appId);
      if (info.start) card.setStartTimestamp(info.start);
      if (info.end) card.setEndTimestamp(info.end);
      if (info.image && appId && RichPresence.getExternal) {
        try {
          const external = await RichPresence.getExternal(client, appId, info.image);
          const path = external?.[0]?.external_asset_path;
          if (path) card.setAssetsLargeImage(path).setAssetsLargeText(info.name);
        } catch {
          // The card is still worth sending without the picture.
        }
      }
      client.user.setPresence({ activities: [card] });
    } catch (err) {
      if (!warned) console.error(`Account status failed: ${err?.message ?? err}`);
      warned = true;
    }
  };
}

// Back to back videos clear and set the status within a second of each other.
// Wait for things to settle and send only the last state.
export function debounced(apply, ms = 1000) {
  let timer = null;
  return (value) => {
    clearTimeout(timer);
    timer = setTimeout(() => apply(value), ms);
  };
}
