import test from "node:test";
import assert from "node:assert/strict";
import {
  cardRules,
  newCardGame,
  cardTransition,
  cardView,
} from "../src/card-game.mjs";
const now = 10000;
export function testDeck(pick = 1) {
  return {
    white: Array.from({ length: 150 }, (_, i) => ({
      text: `Original test answer ${i}`,
    })),
    black: Array.from({ length: 12 }, (_, i) => ({
      text: `Original test prompt ${i}: _`,
      pick,
      draw: pick === 3 ? 2 : 0,
    })),
    available: { white: 150, black: 12 },
    packs: [{ id: "test", name: "Original test deck" }],
  };
}
export function lobby(rules = {}, pick = 1) {
  let s = newCardGame("100", rules, testDeck(pick), now);
  for (const id of ["100", "200", "300"])
    s = cardTransition(s, id, { type: "join" }, now);
  return s;
}
function start(rules = {}, pick = 1) {
  return cardTransition(lobby(rules, pick), "100", { type: "start" }, now);
}
const submit = (s, id) =>
  cardTransition(
    s,
    id,
    {
      type: "submit",
      cards: s.players
        .find((p) => p.user === id)
        .hand.slice(0, s.deck.black[s.prompt].pick),
    },
    now,
  );
test("default rules and strict custom rule limits", () => {
  assert.equal(cardRules().handSize, 10);
  for (const rules of [
    { handSize: 100 },
    { seconds: -1 },
    { maxPlayers: 2 },
    { judgeMode: "audience" },
    { redraw: "yes" },
    { roundLimit: Infinity },
  ])
    assert.throws(() => cardRules(rules));
});
test("private hands, shuffled anonymous answers, scoring and rotating judges", () => {
  let s = start();
  const a = cardView(s, "200").game,
    b = cardView(s, "300").game,
    spectator = cardView(s, null).game;
  assert.equal(a.hand.length, 10);
  assert.equal(spectator.hand.length, 0);
  assert.equal(
    a.hand.some((c) => b.hand.some((d) => c.id === d.id)),
    false,
  );
  assert.equal(JSON.stringify(spectator).includes('"user"'), false);
  s = submit(s, "200");
  assert.deepEqual(cardView(s, "100").game.submissions, []);
  assert.equal(cardView(s, "200").game.submitted, true);
  s = submit(s, "300");
  assert.equal(s.phase, "judging");
  const publicSub = cardView(s, "100").game.submissions[0];
  assert.equal(publicSub.player, undefined);
  assert.equal(publicSub.cards.length, 1);
  assert.throws(() =>
    cardTransition(s, "200", { type: "judge", submission: publicSub.id }, now),
  );
  const winner = s.submissions[0].player;
  s = cardTransition(
    s,
    "100",
    { type: "judge", submission: publicSub.id },
    now,
  );
  assert.equal(s.players.find((p) => p.id === winner).score, 1);
  assert.throws(() =>
    cardTransition(s, "100", { type: "judge", submission: publicSub.id }, now),
  );
  s = cardTransition(s, "100", { type: "next" }, now);
  assert.equal(s.judge, "p2");
  assert.equal(s.round, 2);
  assert.ok(s.players.every((p) => p.hand.length === 10));
});
test("ordered Pick 2 and Pick 3, bonus draws, own cards and duplicate submission enforcement", () => {
  for (const pick of [2, 3]) {
    let s = start({ packingHeat: true }, pick);
    const p = s.players[1],
      cards = [...p.hand.slice(0, pick)].reverse();
    assert.equal(p.hand.length, pick === 3 ? 12 : 11);
    assert.throws(() =>
      cardTransition(
        s,
        "200",
        { type: "submit", cards: [cards[0], cards[0]] },
        now,
      ),
    );
    assert.throws(() =>
      cardTransition(
        s,
        "200",
        { type: "submit", cards: s.players[2].hand.slice(0, pick) },
        now,
      ),
    );
    s = cardTransition(s, "200", { type: "submit", cards }, now);
    assert.deepEqual(s.submissions[0].cards, cards);
    assert.throws(() =>
      cardTransition(s, "200", { type: "submit", cards }, now),
    );
    assert.throws(() => submit(s, "100"));
  }
});
test("timeouts, host permissions, explicit skip and no unexpected automated winner", () => {
  let s = start({ seconds: 1 });
  assert.throws(() => cardTransition(s, "200", { type: "skip" }, now));
  assert.throws(() =>
    cardTransition(
      s,
      "200",
      { type: "submit", cards: [s.players[1].hand[0]] },
      now + 1001,
    ),
  );
  assert.throws(() => cardTransition(s, "100", { type: "reveal" }, now));
  s = cardTransition(s, "100", { type: "skip" }, now + 1001);
  assert.equal(s.round, 2);
  assert.ok(s.players.every((p) => p.score === 0));
});
test("fixed host and winner judge modes; score and round limits end games", () => {
  for (const mode of ["host", "winner"]) {
    let s = start({ judgeMode: mode, winningScore: 0, roundLimit: 2 });
    s = submit(submit(s, "200"), "300");
    const sub = s.submissions[0],
      winner = sub.player;
    s = cardTransition(s, "100", { type: "judge", submission: sub.id }, now);
    s = cardTransition(s, "100", { type: "next" }, now);
    assert.equal(s.judge, mode === "host" ? "p1" : winner);
    s = cardTransition(s, "100", { type: "skip" }, now);
    assert.equal(s.phase, "finished");
  }
  let s = start({ winningScore: 1 });
  s = submit(submit(s, "200"), "300");
  s = cardTransition(
    s,
    "100",
    { type: "judge", submission: s.submissions[0].id },
    now,
  );
  assert.equal(s.phase, "finished");
});
test("kick prevents rejoin, late joins happen only between rounds, and judge departure recovers", () => {
  let s = start({ lateJoin: true });
  assert.throws(() => cardTransition(s, "400", { type: "join" }, now));
  s = cardTransition(s, "100", { type: "kick", player: "p2" }, now);
  assert.equal(s.phase, "result");
  assert.throws(() => cardTransition(s, "200", { type: "join" }, now));
  s = cardTransition(s, "400", { type: "join" }, now);
  assert.equal(s.players.at(-1).hand.length, 10);
  s = cardTransition(s, "100", { type: "next" }, now);
  assert.equal(s.players.length, 3);
  s = cardTransition(
    s,
    s.players.find((p) => p.id === s.judge).user,
    { type: "leave" },
    now,
  );
  assert.equal(s.phase, "result");
});
test("redraw costs one point and only works once per round before submission", () => {
  let s = start();
  assert.throws(() => cardTransition(s, "200", { type: "redraw" }, now));
  s.players[1].score = 1;
  s = cardTransition(s, "200", { type: "redraw" }, now);
  assert.equal(s.players[1].score, 0);
  assert.equal(s.players[1].hand.length, 10);
  assert.throws(() => cardTransition(s, "200", { type: "redraw" }, now));
});
test("channel game lifetime and closed projection", () => {
  const s = lobby();
  assert.throws(() =>
    cardTransition(s, "100", { type: "start" }, now + 12 * 3600000),
  );
  const closed = cardTransition(s, "100", { type: "close" }, now);
  assert.deepEqual(cardView(closed, "100"), { game: null });
});
