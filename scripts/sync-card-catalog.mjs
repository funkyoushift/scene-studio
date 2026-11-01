// Downloads data only; never executes upstream code or uploads automatically.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const out = resolve(process.argv[2] || "outputs/card-game-20261101/catalog");
await mkdir(out, { recursive: true });
const sources = [
  { id: "cah", name: "JSON Against Humanity", file: "cah-all-compact.json" },
  {
    id: "community",
    name: "ManyDecks community snapshot",
    file: "md-all-compact.json",
  },
];
const packs = [],
  unique = new Map(),
  receipts = [];
const clean = (value) =>
  String(value || "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .normalize("NFKC")
    .trim();
for (const source of sources) {
  const url = `https://raw.githubusercontent.com/FireRat666/Json-Against-Humanity/latest/${source.file}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error(`${source.id}: HTTP ${response.status}`);
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 40_000_000)
    throw Error("Source exceeds catalog build limit.");
  const data = JSON.parse(raw);
  receipts.push({
    ...source,
    url,
    sha256: createHash("sha256").update(raw).digest("hex"),
    white: data.white.length,
    black: data.black.length,
    packs: Object.keys(data.packs).length,
  });
  for (const [key, pack] of Object.entries(data.packs)) {
    const id = `${source.id}:${key}`;
    const record = {
      id,
      name: clean(pack.name).slice(0, 200),
      source: source.id,
      official: pack.official === true,
      group: clean(pack.sheetName),
      language: clean(pack.language || "unspecified"),
      white: 0,
      black: 0,
      unsupported: 0,
    };
    for (const kind of ["white", "black"])
      for (const index of new Set(pack[kind] || [])) {
        const rawCard = data[kind][index];
        const text = clean(
          typeof rawCard === "string" ? rawCard : rawCard?.text,
        );
        const pick = kind === "black" ? Number(rawCard?.pick ?? 1) : 0;
        const draw =
          kind === "black" ? Number(rawCard?.draw ?? (pick === 3 ? 2 : 0)) : 0;
        if (
          !text ||
          text.length > 1000 ||
          !Number.isInteger(pick) ||
          pick < 0 ||
          pick > 3 ||
          (kind === "black" && pick < 1) ||
          !Number.isInteger(draw) ||
          draw < 0 ||
          draw > 3
        ) {
          record.unsupported++;
          continue;
        }
        const fingerprint = `${kind}|${text.toLocaleLowerCase("en-US").replace(/\s+/g, " ")}|${pick}|${draw}`;
        let card = unique.get(fingerprint);
        if (!card) {
          card = {
            id: createHash("sha256")
              .update(fingerprint)
              .digest("hex")
              .slice(0, 24),
            text,
            kind,
            pick,
            draw,
            packs: [],
          };
          unique.set(fingerprint, card);
        }
        if (!card.packs.includes(id)) card.packs.push(id);
        record[kind]++;
      }
    record.unsupported += (pack.mechanic || []).length;
    packs.push(record);
  }
}
const shards = Array.from({ length: 32 }, () => []);
let white = 0,
  black = 0;
for (const card of unique.values()) {
  shards[parseInt(card.id.slice(0, 2), 16) % shards.length].push(card);
  card.kind === "white" ? white++ : black++;
}
const version = createHash("sha256")
  .update(JSON.stringify(receipts))
  .digest("hex")
  .slice(0, 16);
const catalog = {
  version,
  fetchedAt: new Date().toISOString(),
  provider: "FireRat / JSON Against Humanity",
  api: "https://cah-api.firer.at/",
  source: "https://github.com/FireRat666/Json-Against-Humanity",
  rights:
    "Upstream declares CC BY-NC-SA 4.0. This is not a rights grant for every third-party pack or for monetized use. Review the selected decks and obtain needed permissions.",
  uniqueWhite: white,
  uniqueBlack: black,
  shards: shards.length,
  receipts,
  packs,
};
const assetRoot = resolve(out, "assets/card-catalog/v1");
await mkdir(resolve(assetRoot, version), { recursive: true });
await writeFile(resolve(assetRoot, "catalog.json"), JSON.stringify(catalog));
for (let i = 0; i < shards.length; i++)
  await writeFile(
    resolve(assetRoot, version, `shard-${i}.json`),
    JSON.stringify(shards[i]),
  );
console.log(
  JSON.stringify(
    {
      out,
      version,
      packs: packs.length,
      uniqueWhite: white,
      uniqueBlack: black,
      sources: receipts,
      unsupported: packs.reduce((n, p) => n + p.unsupported, 0),
    },
    null,
    2,
  ),
);
