// A shuffle bag. Every item plays once before anything repeats, the way a
// shuffled deck works. Picking at random each time would play the same three
// things all evening.

export function createBag({ load, refreshMs = 30 * 60 * 1000, random = Math.random }) {
  let queue = [];
  let loadedAt = 0;
  let lastId = null;
  // What has already played in the current pass.
  const seen = new Set();

  function shuffled(items) {
    const deck = [...items];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    // Do not open a new pass with the item that closed the last one.
    if (deck.length > 1 && deck[0].id === lastId) deck.push(deck.shift());
    return deck;
  }

  async function next() {
    const stale = Date.now() - loadedAt > refreshMs;
    if (!queue.length || stale) {
      const items = await load();
      loadedAt = Date.now();
      if (!queue.length) {
        queue = shuffled(items);
      } else {
        // The list changed mid pass. Keep what is still on it and slip new arrivals in.
        const ids = new Set(items.map((item) => item.id));
        const queued = new Set(queue.map((item) => item.id));
        queue = queue.filter((item) => ids.has(item.id));
        queue.push(...shuffled(items.filter((item) => !queued.has(item.id) && !seen.has(item.id))));
      }
      for (const id of seen) if (!items.some((item) => item.id === id)) seen.delete(id);
    }

    const item = queue.shift() || null;
    if (item) {
      lastId = item.id;
      seen.add(item.id);
    }
    if (!queue.length) seen.clear();
    return item;
  }

  return { next };
}
