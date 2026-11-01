// Shared rules, with all authoritative transitions executed on the server.
export class CardGameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const check = (ok, message, status) => {
  if (!ok) throw new CardGameError(message, status);
};
export const DEFAULT_CARD_RULES = Object.freeze({
  handSize: 10,
  winningScore: 7,
  roundLimit: 30,
  maxPlayers: 12,
  judgeMode: "rotate",
  seconds: 90,
  packingHeat: false,
  redraw: true,
  lateJoin: false,
});
export function cardRules(value = {}) {
  const result = { ...DEFAULT_CARD_RULES };
  for (const [key, min, max] of [
    ["handSize", 5, 20],
    ["winningScore", 0, 50],
    ["roundLimit", 1, 100],
    ["maxPlayers", 3, 20],
    ["seconds", 0, 300],
  ]) {
    const n = value[key] ?? result[key];
    check(Number.isInteger(n) && n >= min && n <= max, `Invalid ${key}.`);
    result[key] = n;
  }
  check(
    ["rotate", "host", "winner"].includes(value.judgeMode ?? result.judgeMode),
    "Choose a judge mode.",
  );
  result.judgeMode = value.judgeMode ?? result.judgeMode;
  for (const key of ["packingHeat", "redraw", "lateJoin"]) {
    check(
      value[key] === undefined || typeof value[key] === "boolean",
      `Invalid ${key}.`,
    );
    result[key] = value[key] ?? result[key];
  }
  return result;
}
export function secureRandom() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] / 4294967296;
}
export function shuffle(array, random = secureRandom) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function newCardGame(host, rules, deck, now = Date.now()) {
  check(
    deck.white.length >= 30 && deck.black.length >= 1,
    "Choose decks with at least 30 answers and one playable prompt.",
  );
  return {
    id: crypto.randomUUID(),
    revision: 0,
    host,
    phase: "lobby",
    rules: cardRules(rules),
    deck,
    players: [],
    blocked: [],
    nextSeat: 1,
    round: 0,
    judge: null,
    prompt: null,
    submissions: [],
    result: null,
    deadline: null,
    whitePile: [],
    whiteDiscard: [],
    blackPile: [],
    expires: now + 12 * 3600000,
  };
}
const seat = (s, id) => s.players.find((p) => p.user === id);
function draw(s, p, count, random) {
  for (let i = 0; i < count; i++) {
    if (!s.whitePile.length) {
      s.whitePile = shuffle(s.whiteDiscard, random);
      s.whiteDiscard = [];
    }
    check(
      s.whitePile.length,
      "Not enough unused answer cards for these rules. Choose a larger deck or fewer players.",
    );
    p.hand.push(s.whitePile.pop());
  }
}
function nextRound(s, now, random, first = false) {
  if (!first && s.round >= s.rules.roundLimit) {
    s.phase = "finished";
    s.deadline = null;
    return;
  }
  for (const sub of s.submissions) s.whiteDiscard.push(...sub.cards);
  s.submissions = [];
  s.result = null;
  for (const p of s.players) {
    p.redrawn = false;
    // Unsubmitted bonus draws do not accumulate indefinitely after skipped rounds.
    if (p.hand.length > s.rules.handSize)
      s.whiteDiscard.push(...p.hand.splice(s.rules.handSize));
    if (p.hand.length < s.rules.handSize)
      draw(s, p, s.rules.handSize - p.hand.length, random);
  }
  if (!s.blackPile.length) {
    s.phase = "finished";
    s.deadline = null;
    s.result = { message: "Every prompt in this match has been played." };
    return;
  }
  s.round++;
  s.prompt = s.blackPile.pop();
  if (s.rules.judgeMode === "host")
    s.judge = s.players.find((p) => p.user === s.host)?.id;
  else if (first) s.judge = s.players[0]?.id;
  else if (
    s.rules.judgeMode === "winner" &&
    s.previousWinner &&
    s.players.some((p) => p.id === s.previousWinner)
  )
    s.judge = s.previousWinner;
  else {
    const index = s.players.findIndex((p) => p.id === s.judge);
    s.judge = s.players[(index + 1) % s.players.length]?.id;
  }
  check(s.judge, "The judge must join before starting.");
  const prompt = s.deck.black[s.prompt];
  const bonus =
    prompt.draw + (s.rules.packingHeat && prompt.pick === 2 ? 1 : 0);
  for (const p of s.players.filter((p) => p.id !== s.judge))
    if (bonus) draw(s, p, bonus, random);
  s.phase = "playing";
  s.deadline = s.rules.seconds ? now + s.rules.seconds * 1000 : null;
}
function reveal(s, random) {
  check(
    s.submissions.length >= 2,
    "Wait for at least two submissions, or skip this round.",
  );
  s.submissions = shuffle(s.submissions, random).map((sub) => ({
    ...sub,
    id: crypto.randomUUID(),
  }));
  s.phase = "judging";
  s.deadline = null;
}
export function cardTransition(
  original,
  actor,
  action,
  now = Date.now(),
  random = secureRandom,
) {
  const s = structuredClone(original),
    host = actor === s.host;
  check(s.expires > now, "This game has expired. Start a new lobby.", 410);
  check(action && typeof action.type === "string", "Choose an action.");
  const hostOnly = () => check(host, "Only the streamer can do that.", 403);
  const p = seat(s, actor);
  if (action.type === "close") {
    hostOnly();
    s.phase = "closed";
    s.deadline = null;
  } else if (action.type === "join") {
    check(
      !s.blocked.includes(actor),
      "The streamer removed you from this game.",
      403,
    );
    if (p) return original;
    check(
      s.phase === "lobby" || (s.rules.lateJoin && s.phase === "result"),
      "Join in the lobby or between rounds when late joining is enabled.",
    );
    check(s.players.length < s.rules.maxPlayers, "The table is full.");
    const player = {
      id: `p${s.nextSeat++}`,
      user: actor,
      name: host ? "Streamer" : `Player ${s.nextSeat - 1}`,
      hand: [],
      score: 0,
      redrawn: false,
    };
    s.players.push(player);
    if (s.phase !== "lobby") draw(s, player, s.rules.handSize, random);
  } else if (action.type === "leave" || action.type === "kick") {
    if (action.type === "kick") hostOnly();
    const target =
      action.type === "kick"
        ? s.players.find((x) => x.id === action.player)
        : p;
    check(target, "Player not found.");
    check(
      target.user !== s.host || s.phase === "lobby",
      "The streamer must end the game to leave.",
    );
    s.whiteDiscard.push(...target.hand);
    s.submissions = s.submissions.filter((sub) => {
      if (sub.player === target.id) {
        s.whiteDiscard.push(...sub.cards);
        return false;
      }
      return true;
    });
    s.players = s.players.filter((x) => x !== target);
    if (action.type === "kick") s.blocked.push(target.user);
    if (
      s.phase !== "lobby" &&
      (s.players.length < 3 || target.id === s.judge)
    ) {
      s.phase = "result";
      s.deadline = null;
      s.result = {
        message:
          "Round stopped because a player or judge left. The streamer can continue with at least three players.",
      };
    }
  } else if (action.type === "rules") {
    hostOnly();
    check(s.phase === "lobby", "Change rules before starting the match.");
    const rules = cardRules(action.rules);
    check(
      rules.maxPlayers >= s.players.length,
      "The player limit is lower than the current table.",
    );
    s.rules = rules;
  } else if (action.type === "start") {
    hostOnly();
    check(s.phase === "lobby", "This game has already started.");
    check(s.players.length >= 3, "At least three players must join.");
    check(seat(s, s.host), "The streamer must join the table.");
    check(
      s.deck.white.length >= s.players.length * (s.rules.handSize + 3),
      "Choose more answer cards for this table size and hand size.",
    );
    s.whitePile = shuffle(
      s.deck.white.map((_, i) => i),
      random,
    );
    s.blackPile = shuffle(
      s.deck.black.map((_, i) => i),
      random,
    );
    nextRound(s, now, random, true);
  } else if (action.type === "submit") {
    check(s.phase === "playing", "This round is not accepting answers.");
    check(!s.deadline || now < s.deadline, "Time is up.");
    check(
      p && p.id !== s.judge,
      "The judge and spectators cannot submit.",
      403,
    );
    check(
      !s.submissions.some((x) => x.player === p.id),
      "Your answer is already submitted.",
    );
    const cards = action.cards;
    check(
      Array.isArray(cards) &&
        cards.length === s.deck.black[s.prompt].pick &&
        new Set(cards).size === cards.length &&
        cards.every((i) => Number.isInteger(i) && p.hand.includes(i)),
      "Select the required number of cards from your own hand, in order.",
    );
    s.submissions.push({ player: p.id, cards: [...cards] });
    p.hand = p.hand.filter((i) => !cards.includes(i));
    if (s.submissions.length === s.players.length - 1) reveal(s, random);
  } else if (action.type === "redraw") {
    check(
      s.rules.redraw &&
        s.phase === "playing" &&
        p &&
        p.id !== s.judge &&
        !p.redrawn &&
        !s.submissions.some((x) => x.player === p.id) &&
        (!s.deadline || now < s.deadline),
      "You cannot redraw now.",
    );
    check(p.score > 0, "A redraw costs one point.");
    const count = p.hand.length;
    s.whiteDiscard.push(...p.hand);
    p.hand = [];
    p.score--;
    p.redrawn = true;
    draw(s, p, count, random);
  } else if (action.type === "reveal") {
    hostOnly();
    check(s.phase === "playing", "No round to reveal.");
    reveal(s, random);
  } else if (action.type === "judge") {
    check(
      s.phase === "judging" && p?.id === s.judge,
      "Only this round’s judge can choose the winner.",
      403,
    );
    const sub = s.submissions.find((x) => x.id === action.submission);
    check(sub, "Choose an answer from this round.");
    const winner = s.players.find((x) => x.id === sub.player);
    check(winner, "That player has left.");
    winner.score++;
    s.previousWinner = winner.id;
    s.result = { winner: winner.id, cards: sub.cards };
    s.phase =
      s.rules.winningScore > 0 && winner.score >= s.rules.winningScore
        ? "finished"
        : "result";
  } else if (action.type === "next" || action.type === "skip") {
    hostOnly();
    check(
      action.type === "next"
        ? s.phase === "result"
        : ["playing", "judging"].includes(s.phase),
      "This action is not available now.",
    );
    check(s.players.length >= 3, "At least three players are needed.");
    nextRound(s, now, random);
  } else throw new CardGameError("Unknown card-game action.");
  s.revision++;
  return s;
}
export function cardView(s, actor) {
  if (!s || s.phase === "closed") return { game: null };
  const p = seat(s, actor);
  const shown = ["judging", "result", "finished"].includes(s.phase);
  return {
    game: {
      id: s.id,
      revision: s.revision,
      phase: s.phase,
      rules: s.rules,
      round: s.round,
      judge: s.judge,
      deadline: s.deadline,
      me: p?.id || null,
      isHost: actor === s.host,
      deck: {
        packs: s.deck.packs,
        available: s.deck.available,
        white: s.deck.white.length,
        black: s.deck.black.length,
      },
      players: s.players.map(({ id, name, score }) => ({ id, name, score })),
      hand: p ? p.hand.map((id) => ({ id, text: s.deck.white[id].text })) : [],
      prompt: s.prompt === null ? null : s.deck.black[s.prompt],
      submitted: !!p && s.submissions.some((x) => x.player === p.id),
      submissionCount: s.submissions.length,
      submissions: shown
        ? s.submissions.map((x) => ({
            id: x.id,
            cards: x.cards.map((i) => s.deck.white[i].text),
          }))
        : [],
      result: s.result
        ? {
            ...s.result,
            cards: s.result.cards?.map((i) => s.deck.white[i].text),
          }
        : null,
    },
  };
}
