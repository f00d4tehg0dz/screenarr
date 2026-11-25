// Plain node tests, no framework. Run with: npm test
import assert from "node:assert/strict";
import http from "node:http";

import { parseCommand, parseTime, formatTime } from "../src/commands.js";
import { createJellyfin } from "../src/jellyfin.js";
import { createPlayer } from "../src/player.js";
import { createHandlers } from "../src/handlers.js";
import { slashDefinitions, createSlash } from "../src/slash.js";
import { describe, botPresence, accountPresence, debounced, cardFor, channelCard } from "../src/presence.js";
import { createBag } from "../src/bag.js";
import { createSeerr } from "../src/seerr.js";
import { createRequests, readyMessage } from "../src/requests.js";
import { createHealth, createStatus, ago } from "../src/health.js";
import { parseLists } from "../src/config.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("commands parse", () => {
  assert.deepEqual(parseCommand("!play  the thing "), { name: "play", arg: "the thing" });
  assert.deepEqual(parseCommand("!NP"), { name: "np", arg: "" });
  assert.equal(parseCommand("hello"), null);
  assert.equal(parseCommand("!"), null);
  assert.deepEqual(parseCommand("?live", "?"), { name: "live", arg: "" });
});

test("times parse and format", () => {
  assert.equal(parseTime("90"), 90);
  assert.equal(parseTime("45:00"), 2700);
  assert.equal(parseTime("1:02:03"), 3723);
  assert.equal(parseTime("soon"), null);
  assert.equal(parseTime("1:2:3:4"), null);
  assert.equal(formatTime(3723), "1:02:03");
  assert.equal(formatTime(65), "1:05");
});

test("jellyfin search and stream url", async () => {
  let seen;
  const server = http.createServer((req, res) => {
    seen = { url: req.url, auth: req.headers.authorization };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      Items: [
        { Id: "a1", Type: "Movie", Name: "Some Movie", ProductionYear: 1999, RunTimeTicks: 72_000_000_000 },
        { Id: "b2", Type: "Episode", Name: "Pilot", SeriesName: "Some Show", ParentIndexNumber: 1, IndexNumber: 2 },
      ],
    }));
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/`;

  const jf = createJellyfin({ baseUrl: base, apiKey: "secret" });
  const items = await jf.search("some");
  server.close();

  assert.equal(seen.auth, 'MediaBrowser Token="secret"');
  assert.match(seen.url, /^\/Items\?.*searchTerm=some/);
  assert.ok(!seen.url.includes("secret"));
  assert.deepEqual(items[0], { id: "a1", title: "Some Movie (1999)", seconds: 7200, artId: "a1" });
  assert.equal(items[1].title, "Some Show S01E02: Pilot");
  assert.ok(jf.streamUrl("a1").endsWith("/Videos/a1/stream?static=true"));

  const server2 = http.createServer((req, res) => {
    seen = { url: req.url };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ Items: [{ Id: "c3", Type: "Movie", Name: "Lucky" }] }));
  });
  await new Promise((r) => server2.listen(0, r));
  const jf2 = createJellyfin({ baseUrl: `http://127.0.0.1:${server2.address().port}`, apiKey: "k" });
  const pick = await jf2.random("lib1");
  server2.close();
  assert.equal(pick.title, "Lucky");
  assert.match(seen.url, /SortBy=Random/);
  assert.match(seen.url, /ParentId=lib1/);
  assert.match(seen.url, /Limit=1/);
  assert.match(seen.url, /IncludeItemTypes=Movie%2CEpisode/);
  assert.ok(!jf.streamUrl("a1").includes("//Videos"));
});

function fakePlay() {
  const played = [];
  const state = { played, finish: null };
  state.play = (source, signal) =>
    new Promise((resolve, reject) => {
      played.push(source.type === "live" ? "live" : source.item.title);
      state.finish = resolve;
      signal.addEventListener("abort", () => reject(new Error("cancelled")));
    });
  return state;
}

test("player switches, cancels and falls back to live", async () => {
  const fake = fakePlay();
  const { played } = fake;
  let liveUp = false;
  const player = createPlayer({
    play: fake.play, probeLive: async () => liveUp, hasLive: true, pollMs: 5, log: () => {},
  });

  await player.step();
  assert.deepEqual(played, [], "nothing plays while the live feed is down");

  liveUp = true;
  let step = player.step();
  await tick();
  assert.equal(player.now().type, "live");

  player.playItem({ id: "a1", title: "Movie", seconds: 100 }, 30);
  await step;
  step = player.step();
  await tick();
  assert.deepEqual(played, ["live", "Movie"]);
  assert.ok(player.now().position >= 30);

  await player.checkLive();
  assert.equal(player.now().item.title, "Movie", "a movie picked while live was up stays on");

  fake.finish();
  await step;
  step = player.step();
  await tick();
  assert.deepEqual(played, ["live", "Movie", "live"], "a finished video returns to live");

  player.stop();
  await step;
  await player.step();
  assert.equal(player.now(), null);
  assert.equal(played.length, 3);
});

test("player fills dead air from the library and live takes over", async () => {
  const fake = fakePlay();
  const { played } = fake;
  let liveUp = false;
  let n = 0;
  const pickIdle = async () => ({ id: `r${++n}`, title: `Random ${n}`, seconds: 60 });
  const player = createPlayer({
    play: fake.play, probeLive: async () => liveUp, hasLive: true, pickIdle, pollMs: 5, log: () => {},
  });

  let step = player.step();
  await tick();
  assert.deepEqual(played, ["Random 1"]);
  assert.equal(player.now().filler, true);

  fake.finish();
  await step;
  step = player.step();
  await tick();
  assert.deepEqual(played, ["Random 1", "Random 2"], "filler keeps going back to back");

  player.auto();
  await step;
  step = player.step();
  await tick();
  assert.deepEqual(played, ["Random 1", "Random 2", "Random 3"], "skip moves to another pick");

  await player.checkLive();
  assert.equal(player.now().item.title, "Random 3", "no switch while live is still down");

  liveUp = true;
  await player.checkLive();
  await step;
  step = player.step();
  await tick();
  assert.equal(player.now().type, "live", "live takes over the moment it comes up");

  liveUp = false;
  fake.finish();
  await step;
  step = player.step();
  await tick();
  assert.equal(played.at(-1), "Random 4", "back to filler when live drops");

  player.stop();
  await step;
  liveUp = true;
  await player.checkLive();
  step = player.step();
  await tick();
  assert.equal(player.now().type, "live", "live coming up overrides a stop");
  player.stop();
  await step;
});

test("player shuffle keeps going until told otherwise", async () => {
  const fake = fakePlay();
  const { played } = fake;
  const asked = [];
  let liveUp = true;
  let n = 0;
  const player = createPlayer({
    play: fake.play, probeLive: async () => liveUp, hasLive: true, pollMs: 5, log: () => {},
    pickShuffle: async (list) => (asked.push(list), { id: `m${++n}`, title: `Movie ${n}`, seconds: 60 }),
  });

  let step = player.step();
  await tick();
  assert.deepEqual(played, ["live"]);

  player.shuffle();
  await step;
  step = player.step();
  await tick();
  assert.deepEqual(played, ["live", "Movie 1"], "shuffle plays even while live is up");
  assert.deepEqual(asked, [""]);

  fake.finish();
  await step;
  step = player.step();
  await tick();
  assert.equal(played.at(-1), "Movie 2", "the next movie follows on its own");

  player.skip();
  await step;
  step = player.step();
  await tick();
  assert.equal(played.at(-1), "Movie 3", "skip stays in shuffle");
  assert.equal(player.isShuffling(), true);

  player.playItem({ id: "x", title: "Asked For", seconds: 10 });
  await step;
  assert.equal(player.isShuffling(), false, "asking for a title ends shuffle");
  step = player.step();
  await tick();
  player.shuffle("christmas");
  await step;
  step = player.step();
  await tick();
  assert.equal(asked.at(-1), "christmas", "a named list is passed through to the picker");
  assert.equal(player.isShuffling("christmas"), true);
  assert.equal(player.isShuffling(), false);

  liveUp = false;
  await player.checkLive();
  liveUp = true;
  await player.checkLive();
  await step;
  step = player.step();
  await tick();
  assert.equal(player.now().type, "live", "live coming up ends shuffle");
  player.stop();
  await step;
});

test("player survives a library that fails", async () => {
  const fake = fakePlay();
  const logs = [];
  const player = createPlayer({
    play: fake.play, probeLive: async () => false, hasLive: true, pollMs: 5,
    pickIdle: async () => { throw new Error("down"); }, log: (m) => logs.push(m),
  });
  await player.step();
  await player.step();
  assert.deepEqual(fake.played, []);
  assert.equal(logs.length, 1, "the reason is logged once, not every poll");
});

test("handlers", async () => {
  const calls = [];
  let now = null;
  let shuffling = null;
  const player = {
    playItem: (item, s = 0) => calls.push(["play", item.id, s]),
    request: (item) => (calls.push(["play", item.id, 0]), 0),
    queue: () => [],
    info: () => ({ mode: "auto", list: "", queued: 0, liveUp: false }),
    auto: () => calls.push(["auto"]),
    skip: () => calls.push(["skip"]),
    shuffle: (list = "") => (calls.push(["shuffle", list]), (shuffling = list)),
    isShuffling: (list = "") => shuffling === list,
    stop: () => calls.push(["stop"]),
    now: () => now,
  };
  const library = [
    { id: "a1", title: "Some Movie (1999)", seconds: 7200 },
    { id: "b2", title: "Some Show S01E02: Pilot", seconds: 0 },
  ];
  const randomCalls = [];
  const jellyfin = {
    search: async (term, limit = 8) => (term === "nope" ? [] : library.slice(0, limit)),
    random: async (parent, types) => (randomCalls.push([parent, types]), library[0]),
  };
  const handle = createHandlers({ jellyfin, player, libraryId: "lib1", lists: ["christmas"] });

  assert.match(await handle({ name: "search", arg: "some" }), /^1\. Some Movie \(1999\) \[2:00:00\]\n2\. /);
  assert.equal(await handle({ name: "play", arg: "2" }), "Playing Some Show S01E02: Pilot");
  assert.match(await handle({ name: "play", arg: "9" }), /only had 2 results/);
  assert.equal(await handle({ name: "play", arg: "some movie" }), "Playing Some Movie (1999)");
  assert.match(await handle({ name: "play", arg: "nope" }), /Nothing in the library/);
  assert.match(await handle({ name: "seek", arg: "10:00" }), /only works on library videos/);

  now = { type: "item", item: library[0], position: 65 };
  assert.equal(await handle({ name: "np", arg: "" }), "Some Movie (1999), 1:05 of 2:00:00");
  assert.equal(await handle({ name: "seek", arg: "45:00" }), "Jumping to 45:00");
  assert.match(await handle({ name: "seek", arg: "3:00:00" }), /past the end/);
  assert.match(await handle({ name: "seek", arg: "later" }), /not a time/);

  assert.match(await handle({ name: "live", arg: "" }), /^Back to the live feed\./);
  assert.equal(await handle({ name: "skip", arg: "" }), "Skipping.");
  assert.equal(await handle({ name: "random", arg: "" }), "Playing Some Movie (1999)");
  assert.deepEqual(randomCalls, [["lib1", "Movie"]], "random asks for movies inside the library limit");
  assert.match(await handle({ name: "shuffle", arg: "" }), /^Shuffle is on\./);
  assert.match(await handle({ name: "shuffle", arg: "" }), /already on/);
  assert.match(await handle({ name: "shuffle", arg: "Christmas" }), /^The christmas list is on\./);
  assert.match(await handle({ name: "shuffle", arg: "christmas" }), /already on/);
  assert.match(await handle({ name: "shuffle", arg: "easter" }), /no list called easter.*christmas/);
  assert.equal(await handle({ name: "stop", arg: "" }), "Stopped.");
  assert.equal(await handle({ name: "dance", arg: "" }), null);
  assert.equal(await handle({ name: "status", arg: "" }), null, "no status provider, no status command");
  assert.deepEqual(calls, [["play", "b2", 0], ["play", "a1", 0], ["play", "a1", 2700], ["auto"], ["skip"], ["play", "a1", 0], ["shuffle", ""], ["shuffle", "christmas"], ["stop"]]);
});

test("slash commands", async () => {
  assert.deepEqual(
    slashDefinitions({ hasLibrary: true, hasLive: true }).map((d) => d.name),
    ["play", "random", "shuffle", "search", "seek", "queue", "np", "skip", "live", "stop", "status"],
  );
  assert.deepEqual(
    slashDefinitions({ hasLibrary: false, hasLive: false }).map((d) => d.name),
    ["np", "skip", "stop", "status"],
  );
  const withLists = slashDefinitions({ hasLibrary: true, hasLive: true, lists: ["christmas", "horror"] });
  const shuffleDef = withLists.find((d) => d.name === "shuffle");
  assert.deepEqual(shuffleDef.options[0].choices, [
    { name: "christmas", value: "christmas" },
    { name: "horror", value: "horror" },
  ]);
  assert.equal(shuffleDef.options[0].required, false);

  for (const def of slashDefinitions({ hasLibrary: true, hasLive: true })) {
    assert.match(def.name, /^[a-z]{1,32}$/);
    assert.ok(def.description.length <= 100);
  }
  const all = slashDefinitions({ hasLibrary: true, hasLive: true });
  assert.deepEqual(all.find((d) => d.name === "queue").options.map((o) => o.name), ["show", "remove", "clear"]);
  assert.equal(all.find((d) => d.name === "status").default_member_permissions, "0", "status is hidden from non admins");

  const library = [{ id: "a1", title: "Some Movie (1999)", seconds: 7200 }];
  const searches = [];
  const jellyfin = { search: async (term, limit) => (searches.push([term, limit]), library) };
  const handled = [];
  const handle = async (cmd) => {
    handled.push(cmd);
    if (cmd.name === "stop") throw new Error("boom");
    return `did ${cmd.name}`;
  };
  let allow = true;
  const onInteraction = createSlash({
    handle, jellyfin, allowed: () => allow, isAdmin: (i) => i.user?.id === "boss", log: () => {},
  });
  const anon = { userId: "", admin: false };

  const fake = (over) => {
    const out = { calls: [] };
    const record = (kind) => async (payload) => void out.calls.push([kind, payload]);
    return Object.assign(out, {
      isAutocomplete: () => false,
      isChatInputCommand: () => true,
      options: {
        getString: (key) => over.strings?.[key] ?? null,
        getFocused: () => over.focused ?? "",
        getSubcommand: () => over.sub ?? "show",
        getInteger: (key) => over.ints?.[key] ?? null,
      },
      respond: record("respond"),
      reply: record("reply"),
      deferReply: record("defer"),
      editReply: record("edit"),
    }, over);
  };

  const short = fake({ isAutocomplete: () => true, isChatInputCommand: () => false, focused: "s" });
  await onInteraction(short);
  assert.deepEqual(short.calls, [["respond", []]]);
  assert.equal(searches.length, 0, "one letter is not worth a search");

  const typing = fake({ isAutocomplete: () => true, isChatInputCommand: () => false, focused: "some" });
  await onInteraction(typing);
  assert.deepEqual(typing.calls, [["respond", [{ name: "Some Movie (1999)", value: "a1" }]]]);

  const picked = fake({ commandName: "play", strings: { title: "a1" } });
  await onInteraction(picked);
  assert.deepEqual(handled.at(-1), { name: "play", arg: "Some Movie (1999)", item: library[0], ...anon });
  assert.deepEqual(picked.calls, [["defer", {}], ["edit", { content: "did play", allowedMentions: { parse: [] } }]]);

  const typedOut = fake({ commandName: "play", strings: { title: "some movie" } });
  await onInteraction(typedOut);
  assert.deepEqual(handled.at(-1), { name: "play", arg: "some movie", ...anon });

  const listPick = fake({ commandName: "shuffle", strings: { list: "christmas" } });
  await onInteraction(listPick);
  assert.deepEqual(handled.at(-1), { name: "shuffle", arg: "christmas", ...anon });
  const plainShuffle = fake({ commandName: "shuffle" });
  await onInteraction(plainShuffle);
  assert.deepEqual(handled.at(-1), { name: "shuffle", arg: "", ...anon });

  await onInteraction(fake({ commandName: "queue", sub: "show", user: { id: "u1" } }));
  assert.deepEqual(handled.at(-1), { name: "queue", arg: "", userId: "u1", admin: false });
  await onInteraction(fake({ commandName: "queue", sub: "remove", ints: { position: 3 }, user: { id: "boss" } }));
  assert.deepEqual(handled.at(-1), { name: "queue", arg: "remove 3", userId: "boss", admin: true });
  await onInteraction(fake({ commandName: "queue", sub: "clear" }));
  assert.equal(handled.at(-1).arg, "clear");

  const statusCall = fake({ commandName: "status", user: { id: "boss" } });
  await onInteraction(statusCall);
  assert.deepEqual(statusCall.calls[0], ["defer", { flags: 64 }], "status is only shown to the person who asked");

  const search = fake({ commandName: "search", strings: { query: "some" } });
  await onInteraction(search);
  assert.deepEqual(search.calls[0], ["defer", { flags: 64 }]);

  const broken = fake({ commandName: "stop" });
  await onInteraction(broken);
  assert.match(String(broken.calls.at(-1)[1]), /did not work/);

  allow = false;
  const count = handled.length;
  const denied = fake({ commandName: "live" });
  await onInteraction(denied);
  assert.equal(denied.calls[0][0], "reply");
  assert.equal(denied.calls[0][1].flags, 64);
  assert.equal(handled.length, count);
});

test("handlers play an item picked from autocomplete", async () => {
  const calls = [];
  const player = {
    request: (item, by) => (calls.push([item.id, by]), 0),
    queue: () => [],
    info: () => ({ mode: "auto" }),
    now: () => null,
  };
  const jellyfin = { search: async () => { throw new Error("should not search"); } };
  const handle = createHandlers({ jellyfin, player });
  const item = { id: "z9", title: "Picked", seconds: 60 };
  assert.equal(await handle({ name: "play", arg: "Picked", item, userId: "u1" }), "Playing Picked");
  assert.deepEqual(calls, [["z9", "u1"]]);
});

test("status text and timing", () => {
  assert.equal(describe(null), null);
  assert.deepEqual(describe({ type: "live", startedAt: 5000 }, "Game night"), { name: "Game night", state: "Live", start: 5000 });
  assert.deepEqual(
    describe({ type: "item", item: { title: "Movie", seconds: 100 }, startSeconds: 30, startedAt: 50000 }),
    { name: "Movie", state: "Requested", start: 20000, end: 120000 },
  );
  const filler = describe({ type: "item", item: { title: "Pick", seconds: 0 }, filler: true, startedAt: 1 });
  assert.equal(filler.state, "Shuffle");
  assert.equal("end" in filler, false);
});

test("status goes to the bot and the account without throwing", async () => {
  const botCalls = [];
  const bot = { user: { setActivity: (...a) => botCalls.push(a), setPresence: (p) => botCalls.push(["clear", p]) } };
  const setBot = botPresence(bot, 3);
  setBot({ name: "Movie" });
  setBot(null);
  assert.deepEqual(botCalls, [["Movie", { type: 3 }], ["clear", { activities: [] }]]);
  botPresence({ user: { setActivity() { throw new Error("no"); } } }, 3)({ name: "x" });

  const sent = [];
  const client = { user: { setPresence: (p) => sent.push(p), setActivity: (...a) => sent.push(a) } };
  class Card {
    constructor() { this.f = {}; }
    setType(v) { this.f.type = v; return this; }
    setName(v) { this.f.name = v; return this; }
    setState(v) { this.f.state = v; return this; }
    setApplicationId(v) { this.f.app = v; return this; }
    setStartTimestamp(v) { this.f.start = v; return this; }
    setEndTimestamp(v) { this.f.end = v; return this; }
  }
  const setAccount = accountPresence(client, Card, "123");
  await setAccount({ name: "Movie", state: "Requested", start: 10, end: 20 });
  assert.deepEqual(sent[0].activities[0].f, { type: "WATCHING", name: "Movie", state: "Requested", app: "123", start: 10, end: 20 });
  await setAccount(null);
  assert.deepEqual(sent[1], { activities: [] });

  await accountPresence(client, null)({ name: "Plain", state: "Live" });
  assert.deepEqual(sent[2], ["Plain", { type: "WATCHING" }]);

  class ArtCard extends Card {
    static async getExternal(c, app, url) {
      return [{ external_asset_path: `external/${app}/${url.length}` }];
    }
    setAssetsLargeImage(v) { this.f.image = v; return this; }
    setAssetsLargeText(v) { this.f.imageText = v; return this; }
  }
  await accountPresence(client, ArtCard, "123")({ name: "Movie", state: "Shuffle", image: "https://img.example/p.jpg" });
  assert.equal(sent[3].activities[0].f.image, "external/123/25");
  assert.equal(sent[3].activities[0].f.imageText, "Movie");

  await accountPresence(client, ArtCard, "")({ name: "Movie", state: "Shuffle", image: "https://img.example/p.jpg" });
  assert.equal("image" in sent[4].activities[0].f, false, "no application id means no poster, but the card still goes out");

  class BrokenArt extends ArtCard {
    static async getExternal() { throw new Error("nope"); }
  }
  await accountPresence(client, BrokenArt, "123")({ name: "Movie", state: "Shuffle", image: "https://img.example/p.jpg" });
  assert.equal(sent[5].activities[0].f.name, "Movie", "a failed poster lookup does not lose the card");

  const seen = [];
  const push = debounced((v) => seen.push(v), 10);
  push(1); push(null); push(3);
  await tick();
  assert.deepEqual(seen, [3], "only the last state is sent");
});

test("now playing card", async () => {
  assert.equal(cardFor(null).title, "Nothing is playing");
  const card = cardFor({ name: "Movie", state: "Requested", start: 20000, end: 120000, image: "https://img.example/p.jpg" });
  assert.equal(card.title, "Movie");
  assert.equal(card.description, "Requested\nStarted <t:20:R>\nEnds <t:120:t>");
  assert.deepEqual(card.thumbnail, { url: "https://img.example/p.jpg" });
  assert.equal("thumbnail" in cardFor({ name: "Live stream", state: "Live", start: 1 }), false);

  const log = [];
  const makeMessage = (embeds) => ({
    author: { id: "bot" }, embeds,
    edit: async (payload) => void log.push(["edit", payload.embeds[0].title]),
  });
  let existing = [];
  const channel = {
    messages: { fetch: async () => ({ find: (fn) => existing.find(fn) }) },
    send: async (payload) => (log.push(["send", payload.embeds[0].title]), makeMessage(payload.embeds)),
  };
  const bot = { user: { id: "bot" }, channels: { fetch: async () => channel } };

  const set = channelCard(bot, "chan");
  await set({ name: "One", state: "Shuffle" });
  await set({ name: "Two", state: "Shuffle" });
  await set(null);
  assert.deepEqual(log, [["send", "One"], ["edit", "Two"], ["edit", "Nothing is playing"]], "one message, edited in place");

  log.length = 0;
  existing = [{ author: { id: "someone" }, embeds: [{}] }, makeMessage([{}])];
  await channelCard(bot, "chan")({ name: "After restart", state: "Live" });
  assert.deepEqual(log, [["edit", "After restart"]], "an old card is reused after a restart");

  const broken = { user: { id: "bot" }, channels: { fetch: async () => { throw new Error("no access"); } } };
  await channelCard(broken, "chan")({ name: "x", state: "Live" });
});

test("jellyfin finds a public poster", async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/Items/show1/RemoteImages")) {
      return res.end(JSON.stringify({ Images: [{ Url: "https://img.example/show.jpg" }] }));
    }
    if (req.url.startsWith("/Items/local1/RemoteImages")) {
      return res.end(JSON.stringify({ Images: [{ Url: "http://10.0.0.5/private.jpg" }] }));
    }
    if (req.url.startsWith("/Items/gone/RemoteImages")) { res.statusCode = 500; return res.end("{}"); }
    res.end(JSON.stringify({ Items: [
      { Id: "e1", Type: "Episode", Name: "Pilot", SeriesName: "Show", SeriesId: "show1", ParentIndexNumber: 1, IndexNumber: 1 },
    ] }));
  });
  await new Promise((r) => server.listen(0, r));
  const jf = createJellyfin({ baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: "k" });

  const [episode] = await jf.search("pilot");
  assert.equal(episode.artId, "show1", "an episode uses its show for art");
  assert.equal(await jf.poster(episode.artId), "https://img.example/show.jpg");
  assert.match(hits.at(-1), /type=Primary/);
  const before = hits.length;
  await jf.poster(episode.artId);
  assert.equal(hits.length, before, "posters are cached");
  assert.equal(await jf.poster("local1"), null, "only https links are passed to Discord");
  assert.equal(await jf.poster("gone"), null, "a failed lookup is not an error");
  assert.equal(await jf.poster(""), null);
  server.close();
});

test("player reports changes", async () => {
  const fake = fakePlay();
  const changes = [];
  const player = createPlayer({
    play: fake.play, probeLive: async () => true, hasLive: true, pollMs: 5, log: () => {},
    onChange: (now) => changes.push(now ? now.type : null),
  });
  const step = player.step();
  await tick();
  player.stop();
  await step;
  assert.deepEqual(changes, ["live", null]);
});

test("lists parse from settings", () => {
  assert.deepEqual(parseLists("christmas:abc123, Horror Night:def456"), { christmas: "abc123", horrornight: "def456" });
  assert.deepEqual(parseLists(""), {});
  assert.deepEqual(parseLists("nocolon,:noname,noid:"), {});
});

test("bag plays everything once before repeating", async () => {
  let library = ["a", "b", "c", "d"].map((id) => ({ id, title: id }));
  let loads = 0;
  const bag = createBag({ load: async () => (loads++, library), refreshMs: 1e9 });

  const first = [];
  for (let i = 0; i < 4; i++) first.push((await bag.next()).id);
  assert.deepEqual([...first].sort(), ["a", "b", "c", "d"], "one full pass, no repeats");

  const second = [];
  for (let i = 0; i < 4; i++) second.push((await bag.next()).id);
  assert.deepEqual([...second].sort(), ["a", "b", "c", "d"], "second pass covers everything again");
  assert.notEqual(second[0], first[3], "a new pass does not open with the last thing played");
  assert.equal(loads, 2, "the list is reloaded once per pass");

  const empty = createBag({ load: async () => [] });
  assert.equal(await empty.next(), null);

  const solo = createBag({ load: async () => [{ id: "only", title: "only" }] });
  assert.equal((await solo.next()).id, "only");
  assert.equal((await solo.next()).id, "only");
});

test("bag picks up playlist changes mid pass", async () => {
  let library = ["a", "b", "c"].map((id) => ({ id, title: id }));
  // A fixed "random" keeps the order a, b, c so the test cannot flake.
  const bag = createBag({ load: async () => library, refreshMs: -1, random: () => 0.999 });
  const played = [(await bag.next()).id];
  assert.equal(played[0], "a");
  library = [{ id: "b", title: "b" }, { id: "new", title: "new" }];
  played.push((await bag.next()).id, (await bag.next()).id);
  assert.ok(!played.slice(1).includes("c"), "something removed from the playlist is dropped");
  assert.ok(played.includes("new"), "something added to the playlist gets its turn");
  assert.equal(new Set(played).size, 3, "still no repeats");
});

test("jellyfin lists a playlist and falls back for a collection", async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/Playlists/pl1/Items")) {
      return res.end(JSON.stringify({ Items: [
        { Id: "m1", Type: "Movie", Name: "Holiday One", MediaType: "Video", RunTimeTicks: 36_000_000_000 },
        { Id: "s1", Type: "Audio", Name: "A Song", MediaType: "Audio" },
      ] }));
    }
    if (req.url.startsWith("/Playlists/")) { res.statusCode = 404; return res.end("{}"); }
    res.end(JSON.stringify({ Items: [{ Id: "c1", Type: "Movie", Name: "From Collection" }] }));
  });
  await new Promise((r) => server.listen(0, r));
  const jf = createJellyfin({ baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: "k", userId: "u1" });

  const playlist = await jf.list("pl1");
  assert.deepEqual(playlist, [{ id: "m1", title: "Holiday One", seconds: 3600, artId: "m1" }], "audio is left out");
  assert.match(hits[0], /userId=u1/);

  const collection = await jf.list("col9");
  server.close();
  assert.equal(collection[0].title, "From Collection");
  assert.match(hits.at(-1), /^\/Items\?.*ParentId=col9/);
});

test("seerr client", async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ method: req.method, url: req.url, key: req.headers["x-api-key"], body });
      res.setHeader("Content-Type", "application/json");
      if (req.url.startsWith("/api/v1/search")) {
        return res.end(JSON.stringify({ results: [
          { id: 603, mediaType: "movie", title: "Some Movie", releaseDate: "1999-03-31", posterPath: "/abc.jpg", mediaInfo: { status: 5 } },
          { id: 9, mediaType: "person", name: "Some Actor" },
          { id: 1399, mediaType: "tv", name: "Some Show", firstAirDate: "2011-04-17" },
        ] }));
      }
      if (req.url === "/api/v1/request" && req.method === "POST") return res.end(JSON.stringify({ id: 77 }));
      if (req.url.startsWith("/api/v1/request?")) {
        return res.end(JSON.stringify({ results: [
          { id: 77, type: "movie", media: { tmdbId: 603 } },
          { id: 78, type: "tv", media: { tmdbId: 1399 } },
        ] }));
      }
      if (req.url === "/api/v1/tv/1399") return res.end(JSON.stringify({ name: "Some Show", firstAirDate: "2011-04-17", posterPath: "/tv.jpg" }));
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, r));
  const seerr = createSeerr({ baseUrl: `http://127.0.0.1:${server.address().port}/`, apiKey: "secret" });

  const found = await seerr.search("some movie & more");
  assert.equal(hits[0].url, "/api/v1/search?query=some%20movie%20%26%20more&page=1", "spaces are %20, never a plus");
  assert.equal(hits[0].key, "secret");
  assert.deepEqual(found.map((c) => c.title), ["Some Movie (1999)", "Some Show (2011)"], "people are left out");
  assert.deepEqual(found[0], {
    mediaType: "movie", mediaId: 603, title: "Some Movie (1999)", kind: "Movie", status: 5,
    poster: "https://image.tmdb.org/t/p/w500/abc.jpg",
  });
  assert.equal(found[1].poster, null);

  assert.deepEqual(await seerr.request(found[0]), { id: 77 });
  assert.deepEqual(JSON.parse(hits.at(-1).body), { mediaType: "movie", mediaId: 603 });
  await seerr.request(found[1]);
  assert.deepEqual(JSON.parse(hits.at(-1).body), { mediaType: "tv", mediaId: 1399, seasons: "all" });

  assert.deepEqual(await seerr.available(), [
    { id: 77, mediaType: "movie", mediaId: 603 },
    { id: 78, mediaType: "tv", mediaId: 1399 },
  ]);
  assert.match(hits.at(-1).url, /filter=available/);

  const show = await seerr.details("tv", 1399);
  assert.equal(show.title, "Some Show (2011)");
  assert.equal(show.kind, "Show");
  await assert.rejects(seerr.details("movie", 1), /Seerr answered 404/);
  server.close();
});

test("requests: asking, and announcing arrivals", async () => {
  const made = [];
  let finished = [{ id: 1, mediaType: "movie", mediaId: 10 }];
  const catalog = {
    fresh: { mediaType: "movie", mediaId: 20, title: "Fresh (2026)", kind: "Movie", status: 0, poster: "https://img.example/f.jpg" },
    here: { mediaType: "movie", mediaId: 21, title: "Here (2020)", kind: "Movie", status: 5 },
    coming: { mediaType: "tv", mediaId: 22, title: "Coming (2025)", kind: "Show", status: 3 },
  };
  const seerr = {
    search: async (q) => (catalog[q] ? [catalog[q]] : []),
    request: async (choice) => (made.push(choice.mediaId), { id: 50 + made.length }),
    available: async () => finished,
    details: async (type, id) => ({ title: `Title ${id}`, kind: type === "tv" ? "Show" : "Movie", poster: null }),
  };
  const posts = [];
  const requests = createRequests({ seerr, announce: async (m) => void posts.push(m), log: () => {} });

  assert.match(await requests.submit({ query: "" }), /^Request what\?/);
  assert.match(await requests.submit({ query: "nothing" }), /turned up/);
  assert.match(await requests.submit({ query: "here" }), /already in the library/);
  assert.match(await requests.submit({ query: "coming" }), /already been requested/);
  assert.deepEqual(made, [], "nothing is sent for things that are here or on the way");

  assert.match(await requests.submit({ query: "fresh", userId: "u1" }), /^Requested Fresh \(2026\)\. I will post/);
  assert.match(await requests.submit({ pick: catalog.fresh }), /^Requested/);
  assert.deepEqual(made, [20, 20]);

  await requests.poll();
  assert.deepEqual(posts, [], "what was already finished at startup is old news");

  finished = [{ id: 51, mediaType: "movie", mediaId: 20 }, { id: 90, mediaType: "tv", mediaId: 30 }, ...finished];
  await requests.poll();
  assert.equal(posts.length, 2);
  assert.equal(posts[0].content, "<@u1> your request is in.", "the person who asked gets the ping");
  assert.equal(posts[0].embeds[0].title, "Title 20 is ready");
  assert.equal("content" in posts[1], false, "a request made elsewhere is announced without a ping");
  assert.match(posts[1].embeds[0].description, /^Show added/);

  await requests.poll();
  assert.equal(posts.length, 2, "nothing is announced twice");

  const down = createRequests({
    seerr: { ...seerr, available: async () => { throw new Error("offline"); } },
    announce: async () => {}, log: () => {},
  });
  await down.poll();

  const silent = createRequests({ seerr });
  assert.equal(await silent.submit({ query: "fresh" }), "Requested Fresh (2026).");

  const withArt = readyMessage({ title: "X", poster: "https://img.example/x.jpg" });
  assert.deepEqual(withArt.embeds[0].thumbnail, { url: "https://img.example/x.jpg" });
});

test("request command through slash and handlers", async () => {
  const submitted = [];
  const requests = { submit: async (r) => (submitted.push(r), "ok") };
  const handle = createHandlers({ jellyfin: null, player: { now: () => null }, requests });
  assert.equal(await handle({ name: "request", arg: "alien", userId: "u9" }), "ok");
  assert.deepEqual(submitted[0], { query: "alien", pick: undefined, userId: "u9" });
  assert.equal(await createHandlers({ jellyfin: null, player: {} })({ name: "request", arg: "x" }), "Requests are not set up.");

  assert.ok(slashDefinitions({ hasLibrary: false, hasLive: false, hasRequests: true }).some((d) => d.name === "request"));
  assert.ok(!slashDefinitions({ hasLibrary: true, hasLive: true }).some((d) => d.name === "request"));

  const choice = { mediaType: "tv", mediaId: 1399, title: "Some Show (2011)", kind: "Show", status: 0 };
  const seerr = { search: async () => [choice] };
  const handled = [];
  const onInteraction = createSlash({ handle: async (c) => (handled.push(c), "done"), jellyfin: null, seerr, log: () => {} });
  const calls = [];
  const base = {
    commandName: "request", user: { id: "u7" },
    respond: async (c) => void calls.push(c), deferReply: async () => {}, editReply: async () => {}, reply: async () => {},
  };
  await onInteraction({ ...base, isAutocomplete: () => true, isChatInputCommand: () => false, options: { getFocused: () => "some" } });
  assert.deepEqual(calls[0], [{ name: "Some Show (2011) [Show]", value: "tv:1399" }]);

  const auto = { isAutocomplete: () => false, isChatInputCommand: () => true };
  await onInteraction({ ...base, ...auto, options: { getString: () => "tv:1399" } });
  assert.deepEqual(handled[0], { name: "request", arg: "Some Show (2011)", pick: choice, userId: "u7", admin: false });
  await onInteraction({ ...base, ...auto, options: { getString: () => "typed it out" } });
  assert.deepEqual(handled[1], { name: "request", arg: "typed it out", userId: "u7", admin: false });
});

// A real player with a fake screen, for the tests where commands and the
// player have to agree with each other.
function stage(options = {}) {
  const fake = fakePlay();
  const player = createPlayer({
    play: fake.play, probeLive: async () => false, hasLive: true, pollMs: 5, log: () => {}, ...options,
  });
  let step = null;
  // Lets the loop start whatever is next and waits for it to be on screen.
  const settle = async () => {
    if (step) await Promise.race([step, tick()]);
    step = player.step();
    await tick();
  };
  return { player, fake, settle, end: () => fake.finish() };
}

const movie = (n, seconds = 600) => ({ id: `m${n}`, title: `Movie ${n}`, seconds });

test("queue: picks line up and play in order", async () => {
  const { player, fake, settle, end } = stage();
  const jellyfin = { search: async (t) => [movie(t)], random: async () => movie("r") };
  const handle = createHandlers({ jellyfin, player, prefix: "/", queueMax: 3 });

  assert.equal(await handle({ name: "queue" }), "The queue is empty.");
  assert.equal(await handle({ name: "play", arg: "1", userId: "ann" }), "Playing Movie 1");
  await settle();
  assert.equal(await handle({ name: "play", arg: "2", userId: "bob" }), "Queued Movie 2. Number 1 in line.");
  assert.equal(await handle({ name: "random", userId: "cat" }), "Queued Movie r. Number 2 in line.");
  assert.equal(await handle({ name: "play", arg: "3", userId: "ann" }), "Queued Movie 3. Number 3 in line.");
  assert.match(await handle({ name: "play", arg: "4", userId: "ann" }), /queue is full at 3/);
  assert.deepEqual(fake.played, ["Movie 1"], "queueing does not interrupt what is on");

  assert.equal(
    await handle({ name: "queue" }),
    "Now: Movie 1 (<@ann>)\n1. Movie 2 [10:00] (<@bob>)\n2. Movie r [10:00] (<@cat>)\n3. Movie 3 [10:00] (<@ann>)",
  );
  assert.match(await handle({ name: "np" }), /3 queued\.$/);

  assert.equal(await handle({ name: "queue", arg: "remove 2", userId: "zed" }), "Removed Movie r.");
  assert.match(await handle({ name: "queue", arg: "remove 9" }), /from 1 to 2/);
  assert.match(await handle({ name: "queue", arg: "dance" }), /^Try \/queue/);

  end();
  await settle();
  assert.deepEqual(fake.played, ["Movie 1", "Movie 2"], "the next in line starts when one ends");
  assert.equal(player.now().by, "bob");

  assert.equal(await handle({ name: "seek", arg: "1:00" }), "Jumping to 1:00");
  await settle();
  assert.equal(player.queue().length, 1, "seeking does not eat the queue");
  assert.equal(player.now().by, "bob", "and the pick still belongs to whoever asked");

  assert.equal(await handle({ name: "skip", userId: "bob" }), "Skipping.");
  await settle();
  assert.equal(player.now().item.title, "Movie 3", "skip moves to the next in line");

  end();
  await settle();
  assert.equal(player.now(), null, "an empty line hands the screen back");
  assert.equal(player.info().mode, "auto");
});

test("queue: stop, live and shuffle empty it", async () => {
  for (const name of ["stop", "live", "shuffle"]) {
    const { player, settle } = stage({ pickShuffle: async () => movie("s") });
    const jellyfin = { search: async (t) => [movie(t)] };
    const handle = createHandlers({ jellyfin, player });
    await handle({ name: "play", arg: "1" });
    await settle();
    await handle({ name: "play", arg: "2" });
    await handle({ name: "play", arg: "3" });
    assert.match(await handle({ name }), /Cleared 2 from the queue\.$/, name);
    assert.equal(player.queue().length, 0, name);
    player.stop();
    await settle();
  }

  const { player, settle } = stage();
  let liveUp = false;
  const live = stage({ probeLive: async () => liveUp });
  live.player.request(movie(1));
  await live.settle();
  live.player.request(movie(2));
  liveUp = true;
  await live.player.checkLive();
  assert.equal(live.player.queue().length, 0, "the live feed coming up empties the queue");
  live.player.stop();
  await live.settle();
  player.stop();
  await settle();
});

test("queue: admins and owners", async () => {
  const { player, settle } = stage();
  const jellyfin = { search: async (t) => [movie(t)] };
  const handle = createHandlers({ jellyfin, player, hasAdmins: true });
  await handle({ name: "play", arg: "1", userId: "ann" });
  await settle();
  await handle({ name: "play", arg: "2", userId: "bob" });
  await handle({ name: "play", arg: "3", userId: "cat" });

  assert.equal(await handle({ name: "queue", arg: "remove 1", userId: "cat" }), "You can only remove your own picks.");
  assert.equal(await handle({ name: "queue", arg: "remove 2", userId: "cat" }), "Removed Movie 3.");
  assert.equal(await handle({ name: "queue", arg: "clear", userId: "cat" }), "Only an admin can clear the queue.");
  assert.equal(await handle({ name: "queue", arg: "remove 1", userId: "boss", admin: true }), "Removed Movie 2.");
  await handle({ name: "play", arg: "4", userId: "bob" });
  assert.equal(await handle({ name: "queue", arg: "clear", userId: "boss", admin: true }), "Cleared 1 from the queue.");
  assert.equal(await handle({ name: "queue", arg: "clear", userId: "boss", admin: true }), "The queue is already empty.");
  player.stop();
  await settle();
});

test("vote skip", async () => {
  let present = ["ann", "bob", "cat", "dan"];
  const { player, settle, end } = stage({ pickShuffle: async () => movie("s") });
  const jellyfin = { search: async (t) => [movie(t)] };
  const handle = createHandlers({ jellyfin, player, listeners: () => present, skipRatio: 0.5 });
  const skip = (userId, admin = false) => handle({ name: "skip", userId, admin });

  assert.equal(await skip("ann"), "Nothing is playing.");

  await handle({ name: "play", arg: "1", userId: "ann" });
  await settle();
  await handle({ name: "play", arg: "2", userId: "ann" });

  assert.equal(await skip("zed"), "Join the voice channel to vote.");
  assert.equal(await skip("bob"), "Skip vote 1 of 3 needed.");
  assert.equal(await skip("bob"), "Skip vote 1 of 3 needed.", "voting twice counts once");
  assert.equal(await skip("cat"), "Skip vote 2 of 3 needed.");
  assert.equal(player.now().item.title, "Movie 1");
  assert.equal(await skip("dan"), "Vote passed with 3 of 4. Skipping.");
  await settle();
  assert.equal(player.now().item.title, "Movie 2");

  assert.equal(await skip("bob"), "Skip vote 1 of 3 needed.", "votes start over for the next item");
  present = ["ann", "cat"];
  assert.equal(await skip("cat"), "Skip vote 1 of 2 needed.", "a vote from someone who left is dropped");
  assert.equal(await skip("ann"), "Skipping.", "whoever picked it can skip it outright");
  await settle();
  assert.equal(player.now(), null);

  await handle({ name: "play", arg: "3", userId: "ann" });
  await settle();
  assert.equal(await skip("boss", true), "Skipping.", "an admin skips outright");
  await settle();

  await handle({ name: "play", arg: "4", userId: "ann" });
  await settle();
  present = [];
  assert.equal(await skip("bob"), "Skipping.", "an unreadable voice channel does not lock skip");
  await settle();

  present = ["ann", "bob", "cat"];
  await handle({ name: "shuffle" });
  await settle();
  assert.equal(player.now().filler, true);
  assert.equal(await skip("bob"), "Skipping.", "nobody votes on a shuffle pick");
  await settle();
  assert.equal(player.isShuffling(), true);
  player.stop();
  await settle();
  end();

  // Majority means more than the ratio: 1 of 1, 2 of 2, 2 of 3, 3 of 4, 3 of 5.
  for (const [people, needed] of [[1, 1], [2, 2], [3, 2], [4, 3], [5, 3]]) {
    const s = stage();
    const crowd = Array.from({ length: people }, (_, i) => `p${i}`);
    const h = createHandlers({ jellyfin, player: s.player, listeners: () => crowd });
    await h({ name: "play", arg: "1", userId: "someone-else" });
    await s.settle();
    for (let i = 0; i < needed - 1; i++) assert.match(await h({ name: "skip", userId: crowd[i] }), /^Skip vote/);
    assert.match(await h({ name: "skip", userId: crowd[needed - 1] }), /^Vote passed/, `${needed} of ${people}`);
    await s.settle();
  }
});

test("status report", async () => {
  let clock = 1_000_000;
  const now = () => clock;
  const health = createHealth({ now, keep: 2 });
  const { player, settle } = stage({ onError: (t) => health.error(t) });
  const status = createStatus({
    health, player, now, timeoutMs: 30,
    services: [
      { name: "Jellyfin", check: async () => "v10.11.0" },
      { name: "Seerr", check: async () => { throw new Error("connect ECONNREFUSED\nstack"); } },
      { name: "Slow", check: () => new Promise(() => {}) },
    ],
    accounts: () => [{ label: "Streaming account", name: "streamer#0" }, { label: "Bot", name: "" }],
    listeners: () => ["a", "b"],
  });

  clock += 3_725_000;
  assert.equal(await status(), [
    "Up 1h 2m",
    "On screen: nothing",
    "Mode: auto, 0 queued",
    "Live feed: down",
    "Jellyfin: ok (v10.11.0)",
    "Seerr: DOWN: connect ECONNREFUSED",
    "Slow: DOWN: no answer",
    "Streaming account: streamer#0",
    "Bot: not connected",
    "In the voice channel: 2",
    "No errors since start.",
  ].join("\n"));

  player.request(movie(1));
  await settle();
  player.request(movie(2));
  health.error("first");
  clock += 90_000;
  health.error("a page of ffmpeg noise\nthe line that matters");
  health.error("third");
  const report = await status();
  assert.match(report, /On screen: Movie 1 at 0:0\d/);
  assert.match(report, /Mode: item, 1 queued/);
  assert.match(report, /Last errors:\n  0s ago: third\n  0s ago: the line that matters$/, "newest first, only the last two kept");
  player.stop();
  await settle();

  const failing = stage({ onError: (t) => health.error(t) });
  failing.fake.play = null;
  const broken = createPlayer({
    play: async () => { throw new Error("ffmpeg exited with code 234"); },
    probeLive: async () => false, hasLive: false, pollMs: 5, log: () => {}, onError: (t) => health.error(t),
  });
  broken.request(movie(9));
  await broken.step();
  assert.match(health.errors()[0].text, /ffmpeg exited with code 234/, "a playback failure lands in the status report");

  assert.equal(ago(5), "5s");
  assert.equal(ago(125), "2m");
  assert.equal(ago(90000), "1d 1h");

  const handleOpen = createHandlers({ jellyfin: null, player, status: async () => "all good" });
  assert.equal(await handleOpen({ name: "status" }), "all good");
  const handleLocked = createHandlers({ jellyfin: null, player, status: async () => "all good", hasAdmins: true });
  assert.equal(await handleLocked({ name: "status", userId: "bob" }), "Only an admin can see the status.");
  assert.equal(await handleLocked({ name: "status", userId: "boss", admin: true }), "all good");
});

function tick() {
  return new Promise((r) => setTimeout(r, 20));
}

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
