import { CardGameError, shuffle } from "./card-game.mjs";
export async function prepareCardDeck(
  catalog,
  ids,
  readShard,
  onProgress = () => {},
  random = Math.random,
) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 4000 ||
    new Set(ids).size !== ids.length
  )
    throw new CardGameError("Choose at least one expansion.");
  const known = new Map(catalog.packs.map((p) => [p.id, p]));
  if (ids.some((id) => !known.has(id)))
    throw new CardGameError(
      "An expansion changed. Refresh the catalog and select it again.",
    );
  const selected = new Set(ids),
    pools = { white: [], black: [] },
    counts = { white: 0, black: 0 },
    caps = { white: 2000, black: 250 };
  for (let i = 0; i < catalog.shards; i++) {
    const cards = await readShard(i);
    for (const card of cards) {
      if (!card.packs.some((id) => selected.has(id))) continue;
      const kind = card.kind,
        n = ++counts[kind],
        slot = n <= caps[kind] ? n - 1 : Math.floor(random() * n);
      if (slot < caps[kind])
        pools[kind][slot] = {
          text: card.text,
          pick: card.pick,
          draw: card.draw,
        };
    }
    onProgress(i + 1, catalog.shards);
  }
  return {
    white: shuffle(pools.white, random),
    black: shuffle(pools.black, random),
    available: counts,
    packs: ids.map((id) => ({ id, name: known.get(id).name })),
    catalogVersion: catalog.version,
  };
}
// Hosts choose the content; viewers can only select cards already in their hand.
// Never accept functions, markup, URLs, arbitrary rules or unbounded deck data.
export function validateMatchDeck(input, catalog) {
  if (
    !input ||
    !Array.isArray(input.white) ||
    !Array.isArray(input.black) ||
    input.white.length < 30 ||
    input.white.length > 2000 ||
    !input.black.length ||
    input.black.length > 250
  )
    throw new CardGameError("Use 30–2,000 answers and 1–250 prompts.");
  if (input.catalogVersion !== catalog.version)
    throw new CardGameError("Refresh the card catalog.", 409);
  const known = new Map(catalog.packs.map((p) => [p.id, p]));
  if (
    !Array.isArray(input.packs) ||
    !input.packs.length ||
    input.packs.length > 4000 ||
    new Set(input.packs.map((p) => p?.id)).size !== input.packs.length ||
    input.packs.some((p) => !known.has(p?.id))
  )
    throw new CardGameError("Select valid expansions.");
  const card = (c, black) => {
    if (
      !c ||
      typeof c.text !== "string" ||
      !c.text.trim() ||
      c.text.length > 1000 ||
      /<[^>]*>/.test(c.text)
    )
      throw new CardGameError("Invalid card text.");
    if (
      black &&
      (!Number.isInteger(c.pick) ||
        c.pick < 1 ||
        c.pick > 3 ||
        !Number.isInteger(c.draw) ||
        c.draw < 0 ||
        c.draw > 3)
    )
      throw new CardGameError("Invalid prompt rules.");
    return black
      ? { text: c.text, pick: c.pick, draw: c.draw }
      : { text: c.text };
  };
  const deck = {
    white: input.white.map((c) => card(c, false)),
    black: input.black.map((c) => card(c, true)),
    packs: input.packs.map((p) => ({ id: p.id, name: known.get(p.id).name })),
    catalogVersion: catalog.version,
  };
  for (const kind of ["white", "black"]) {
    if (
      new Set(
        deck[kind].map(
          (c) =>
            `${c.text.toLowerCase().replace(/\s+/g, " ")}|${c.pick || 0}|${c.draw || 0}`,
        ),
      ).size !== deck[kind].length
    )
      throw new CardGameError("Duplicate cards in the match pile.");
    if (
      !Number.isSafeInteger(input.available?.[kind]) ||
      input.available[kind] < deck[kind].length ||
      input.available[kind] > 1_000_000
    )
      throw new CardGameError("Invalid deck count.");
  }
  deck.available = {
    white: input.available.white,
    black: input.available.black,
  };
  return deck;
}
