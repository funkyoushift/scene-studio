import { CardGameError } from "../src/card-game.mjs";
export const CARD_CATALOG_PREFIX = "card-catalog/v1/";
export function cardStore(env) {
  if (env.CARD_CATALOG)
    return {
      async get(key) {
        const response = await env.CARD_CATALOG.fetch(
          new Request("https://catalog.invalid/" + key),
        );
        if (!response.ok) return null;
        return {
          body: response.body,
          json: () => response.json(),
          headers: response.headers,
        };
      },
    };
  return env.EXPERIENCE_MEDIA;
}
export async function getCardCatalog(bucket) {
  const file = await bucket.get(CARD_CATALOG_PREFIX + "catalog.json");
  if (!file)
    throw new CardGameError(
      "The card catalog has not been installed yet.",
      503,
    );
  return file.json();
}
