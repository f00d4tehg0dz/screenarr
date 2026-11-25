// Decides what should be on screen and keeps it there.
//
// The target is one of four things:
//   auto     the live feed when it is up, otherwise something from the library
//   item     one specific library item someone asked for
//   shuffle  random picks back to back until someone says otherwise
//   idle     nothing
//
// Commands change the target and cancel whatever is playing. The loop picks up
// the new target on its next pass.

export function createPlayer({
  play,
  probeLive,
  hasLive,
  pickIdle = null,
  pickShuffle = null,
  onChange = () => {},
  pollMs = 5000,
  log = console.log,
}) {
  let target = { type: "auto" };
  let current = null;
  let controller = null;
  let wake = null;
  let liveUp = false;
  let checking = false;
  let quietReason = "";

  function setTarget(next) {
    target = next;
    controller?.abort();
    wake?.();
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    }).finally(() => {
      wake = null;
    });
  }

  // Say why nothing is playing once, not every few seconds.
  function quiet(reason) {
    if (reason !== quietReason) log(reason);
    quietReason = reason;
  }

  function changed() {
    try {
      onChange(current);
    } catch {
      // Whoever is listening does not get to break playback.
    }
  }

  async function isLive() {
    liveUp = hasLive ? await probeLive() : false;
    return liveUp;
  }

  // Works out what to put on screen for the current target, or null to wait.
  async function resolve(wanted) {
    if (wanted.type === "item") return wanted;
    if (wanted.type === "shuffle") {
      try {
        const item = await pickShuffle(wanted.list || "");
        if (item) return { type: "item", item, startSeconds: 0, filler: true };
        quiet("Shuffle is on but the library had nothing to offer.");
      } catch (err) {
        quiet(`Shuffle is on but the library did not answer: ${err?.message ?? err}`);
      }
      return null;
    }
    if (await isLive()) return { type: "live" };
    if (!pickIdle) {
      quiet("Live feed is down. Waiting for it.");
      return null;
    }
    try {
      const item = await pickIdle();
      if (item) return { type: "item", item, startSeconds: 0, filler: true };
      quiet("Live feed is down and the library had nothing to offer.");
    } catch (err) {
      quiet(`Live feed is down and the library did not answer: ${err?.message ?? err}`);
    }
    return null;
  }

  async function step() {
    const wanted = target;

    if (wanted.type === "idle") {
      await sleep(pollMs);
      return;
    }

    const source = await resolve(wanted);
    if (target !== wanted) return;
    if (!source) {
      await sleep(pollMs);
      return;
    }
    quietReason = "";

    controller = new AbortController();
    const { signal } = controller;
    current = { ...source, startedAt: Date.now() };
    log(source.type === "live" ? "Showing the live feed." : `Playing ${source.item.title}`);
    changed();

    try {
      await play(source, signal);
    } catch (err) {
      if (!signal.aborted) log(`Playback stopped: ${lastLines(err)}`);
    }

    controller = null;
    current = null;
    changed();

    // A requested video that ran to the end hands the screen back.
    if (!signal.aborted && target === wanted && wanted.type === "item") target = { type: "auto" };
    if (!signal.aborted) await sleep(1500);
  }

  // The live feed takes the screen the moment it comes up, whatever was on.
  // It only fires on the change from down to up. If the feed was already up
  // when someone asked for a movie, that was their call and it stands.
  async function checkLive() {
    if (!hasLive || checking) return;
    if (current?.type === "live") return;
    if (target.type === "auto" && !current) return;
    checking = true;
    try {
      const wasUp = liveUp;
      if ((await isLive()) && !wasUp) {
        log("Live feed came up. Switching to it.");
        setTarget({ type: "auto" });
      }
    } finally {
      checking = false;
    }
  }

  async function run() {
    setInterval(() => checkLive().catch(() => {}), pollMs);
    for (;;) await step();
  }

  return {
    run,
    step,
    checkLive,
    playItem: (item, startSeconds = 0) => setTarget({ type: "item", item, startSeconds }),
    auto: () => setTarget({ type: "auto" }),
    shuffle: (list = "") => setTarget({ type: "shuffle", list }),
    isShuffling: (list = "") => target.type === "shuffle" && (target.list || "") === list,
    // Move on to the next thing without leaving shuffle if it is on.
    skip: () => setTarget(target.type === "item" ? { type: "auto" } : { ...target }),
    stop: () => setTarget({ type: "idle" }),
    now() {
      if (!current) return null;
      const elapsed = (Date.now() - current.startedAt) / 1000;
      return { ...current, position: (current.startSeconds || 0) + elapsed };
    },
  };
}

function lastLines(err, count = 12) {
  return String(err?.shortMessage ?? err?.message ?? err).split("\n").slice(-count).join("\n");
}
