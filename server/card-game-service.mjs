import {
  CardGameError,
  newCardGame,
  cardTransition,
  cardView,
  cardRules,
} from "../src/card-game.mjs";
import {
  getCardCatalog,
  CARD_CATALOG_PREFIX,
  cardStore,
} from "./card-catalog.mjs";
import { validateMatchDeck } from "../src/card-decks.mjs";
import { readExperienceBody } from "./experience-service.mjs";
import {studioChannelEnabled} from './tester-access.mjs';
import {privateTestChannel} from './outbound-policy.mjs';

export async function cardGameRequest(
  request,
  env,
  { channel, route, claims },
  json,
  now = Date.now(),
) {
  try {
    if (
      env.CARD_GAMES_ENABLED !== "true" ||
      !studioChannelEnabled(env,channel) ||
      (!privateTestChannel(env,channel) && !(env.CARD_TEST_CHANNELS||'').split(',').map(s=>s.trim()).includes(channel))
    )
      throw new CardGameError(
        "Card games are not enabled for this channel.",
        404,
      );
    if (!env.IMAGES || !cardStore(env))
      throw new CardGameError("Card game storage is unavailable.", 503);
    const isHost = claims?.role === "broadcaster" && claims.user_id === channel;
    const actor = /^[1-9][0-9]{0,19}$/.test(claims?.user_id || "")
      ? claims.user_id
      : claims?.test_room === true && /^guest_[A-Za-z0-9_-]{43}$/.test(claims.guest_id || '') ? claims.guest_id : null;
    if (route.startsWith("shard-")) {
      if (!isHost)
        throw new CardGameError("Only the streamer can prepare decks.", 403);
      if (request.method !== "GET")
        throw new CardGameError("Method not allowed.", 405);
      if(!/^shard-(?:0|[1-9][0-9]?)$/.test(route))
        throw new CardGameError('Invalid catalog shard.',400);
      const version = new URL(request.url).searchParams.get("v");
      if (!/^[a-f0-9]{16}$/.test(version || ""))
        throw new CardGameError("Invalid catalog version.");
      const catalog=await getCardCatalog(cardStore(env));
      if(version!==catalog.version)throw new CardGameError('Refresh the card catalog.',409);
      if(!Number.isInteger(catalog.shards)||catalog.shards<1||catalog.shards>32||Number(route.slice(6))>=catalog.shards)
        throw new CardGameError('Invalid catalog shard.',400);
      const file = await cardStore(env).get(
        CARD_CATALOG_PREFIX + version + `/${route}.json`,
      );
      if (!file) throw new CardGameError("Catalog data is unavailable.", 404);
      return new Response(file.body, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, max-age=86400",
          "Access-Control-Allow-Origin": env.EXTENSION_ORIGIN,
          Vary: "Origin",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (route === "catalog") {
      if (!isHost)
        throw new CardGameError("Only the streamer can configure decks.", 403);
      if (request.method !== "GET")
        throw new CardGameError("Method not allowed.", 405);
      const catalog = await getCardCatalog(cardStore(env));
      return json(catalog);
    }
    let row = await env.IMAGES.prepare(
      "SELECT revision,game,expires FROM card_games WHERE channel=?1",
    )
      .bind(channel)
      .first();
    let state = row && row.expires > now ? JSON.parse(row.game) : null;
    if (request.method === "GET") return json(cardView(state, actor));
    if (request.method !== "POST")
      throw new CardGameError("Method not allowed.", 405);
    if (!actor)
      throw new CardGameError(
        "Share your Twitch identity to join this game.",
        401,
      );
    let action;
    try {
      action = JSON.parse(
        new TextDecoder().decode(
          await readExperienceBody(request, isHost ? 1_500_000 : 4096),
        ),
      );
    } catch (error) {
      throw new CardGameError(
        error.status === 413
          ? "That request is too large."
          : "Invalid game request.",
        error.status || 400,
      );
    }
    if (!action || typeof action !== "object")
      throw new CardGameError("Invalid game action.");
    if (action.type === "create") {
      if (!isHost)
        throw new CardGameError("Only the streamer can open a table.", 403);
      if (state && state.phase !== "closed" && state.phase !== "finished")
        throw new CardGameError(
          "End the current game before opening another table.",
          409,
        );
      const rules = cardRules(action.rules);
      const catalog = await getCardCatalog(cardStore(env));
      if (action.catalogVersion !== catalog.version)
        throw new CardGameError(
          "The catalog changed. Refresh before opening a table.",
          409,
        );
      const deck = validateMatchDeck(action.deck, catalog);
      state = newCardGame(actor, rules, deck, now);
      state = cardTransition(state, actor, { type: "join" }, now);
    } else {
      if (!state) throw new CardGameError("There is no active game.", 404);
      if (action.gameId !== state.id || action.revision !== state.revision)
        throw new CardGameError(
          "The table changed. Refresh and try your action again.",
          409,
        );
      state = cardTransition(state, actor, action, now);
    }
    const encoded = JSON.stringify(state);
    if (new TextEncoder().encode(encoded).length > 1_500_000)
      throw new CardGameError(
        "This combination has unusually long cards. Select fewer decks.",
        413,
      );
    // Optimistic compare-and-swap: simultaneous submissions cannot lose hands,
    // points or turns; a stale action is rejected rather than silently replayed.
    const revision = (row?.revision || 0) + 1;
    const update = row
      ? await env.IMAGES.prepare(
          "UPDATE card_games SET revision=?1,game=?2,expires=?3 WHERE channel=?4 AND revision=?5",
        )
          .bind(revision, encoded, state.expires, channel, row.revision)
          .run()
      : await env.IMAGES.prepare(
          "INSERT OR IGNORE INTO card_games(channel,revision,game,expires) VALUES(?1,?2,?3,?4)",
        )
          .bind(channel, revision, encoded, state.expires)
          .run();
    if (!update.meta.changes)
      throw new CardGameError(
        "Another player just updated the table. Refresh and try again.",
        409,
      );
    return json(cardView(state, actor));
  } catch (error) {
    return json(
      {
        error:
          error instanceof CardGameError
            ? error.message
            : "The card table is temporarily unavailable.",
      },
      error instanceof CardGameError ? error.status : 503,
    );
  }
}
