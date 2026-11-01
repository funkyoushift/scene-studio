import React, { useEffect, useRef, useState } from "react";
import { IMAGE_ORIGIN } from "./image-address.mjs";
import { DEFAULT_CARD_RULES } from "./card-game.mjs";
import { prepareCardDeck } from "./card-decks.mjs";
import "./card-game.css";

export async function cardRequest(auth, route, action) {
  if (!auth?.token || !/^\d+$/.test(auth.channelId))
    throw Error("Open this game in the Twitch extension.");
  const response = await fetch(
    `${IMAGE_ORIGIN}/v1/cards/${auth.channelId}/${route}`,
    {
      method: action ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        ...(action ? { "Content-Type": "application/json" } : {}),
      },
      body: action ? JSON.stringify(action) : undefined,
      signal: AbortSignal.timeout(action?.type === "create" ? 90000 : 15000),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      Error(data.error || "The card table could not be reached."),
      { status: response.status },
    );
  return data;
}
function Rules({ value, onChange, disabled }) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  return (
    <fieldset className="cg-rules" disabled={disabled}>
      <legend>Rules for this match</legend>
      {[
        ["handSize", "Cards in each hand", 5, 20],
        ["winningScore", "Points to win (0 = round limit only)", 0, 50],
        ["roundLimit", "Maximum rounds", 1, 100],
        ["maxPlayers", "Seats at the table", 3, 20],
        ["seconds", "Seconds to submit (0 = no timer)", 0, 300],
      ].map(([key, label, min, max]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            min={min}
            max={max}
            value={value[key]}
            onChange={(e) =>
              set(key, e.target.value === "" ? "" : Number(e.target.value))
            }
          />
        </label>
      ))}
      <label>
        Who judges?
        <select
          value={value.judgeMode}
          onChange={(e) => set("judgeMode", e.target.value)}
        >
          <option value="rotate">Rotate through the players</option>
          <option value="host">Streamer always judges</option>
          <option value="winner">Previous winner judges</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.packingHeat}
          onChange={(e) => set("packingHeat", e.target.checked)}
        />
        Packing Heat: draw one extra card for Pick 2
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.redraw}
          onChange={(e) => set("redraw", e.target.checked)}
        />
        Allow a full-hand redraw for one point, once per round
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.lateJoin}
          onChange={(e) => set("lateJoin", e.target.checked)}
        />
        Let new players join between rounds
      </label>
    </fieldset>
  );
}
function Setup({ catalog, rules, setRules, packs, setPacks, busy, onCreate }) {
  const [search, setSearch] = useState(""),
    [source, setSource] = useState("cah"),
    [official, setOfficial] = useState(false),
    [language, setLanguage] = useState(""),
    [limit, setLimit] = useState(80);
  const filtered = catalog.packs.filter(
    (p) =>
      (!source || p.source === source) &&
      (!official || p.official) &&
      (!language || p.language === language) &&
      `${p.name} ${p.group}`.toLowerCase().includes(search.toLowerCase()),
  );
  const selected = new Set(packs),
    languages = [...new Set(catalog.packs.map((p) => p.language))].sort();
  const toggle = (id) =>
    setPacks(selected.has(id) ? packs.filter((x) => x !== id) : [...packs, id]);
  return (
    <div className="cg-setup">
      <section>
        <h3>Choose your decks</h3>
        <p>
          {catalog.packs.length.toLocaleString()} packs ·{" "}
          {(catalog.uniqueWhite + catalog.uniqueBlack).toLocaleString()}{" "}
          supported unique cards in this snapshot.
        </p>
        <div className="cg-filters">
          <label>
            Find expansions
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(80);
              }}
              placeholder="Base game, science, fantasy…"
            />
          </label>
          <label>
            Collection
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setLimit(80);
              }}
            >
              <option value="cah">Main catalog</option>
              <option value="community">Community / ManyDecks</option>
              <option value="">Both collections</option>
            </select>
          </label>
          <label>
            Language
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="">All / unspecified</option>
              {languages.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={official}
              onChange={(e) => setOfficial(e.target.checked)}
            />
            Only packs marked official by the source
          </label>
        </div>
        <div className="cg-actions">
          <button
            disabled={busy}
            onClick={() =>
              setPacks([...new Set([...packs, ...filtered.map((p) => p.id)])])
            }
          >
            Select all {filtered.length} matching
          </button>
          <button disabled={busy} onClick={() => setPacks([])}>
            Clear selection
          </button>
          <strong>{packs.length} selected</strong>
        </div>
        <div className="cg-pack-list">
          {filtered.slice(0, limit).map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                disabled={busy}
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
              />
              <span>
                <b>{p.name}</b>
                <small>
                  {p.white} answers · {p.black} prompts · {p.group}
                  {p.unsupported
                    ? ` · ${p.unsupported} special/unsupported entries excluded`
                    : ""}
                </small>
              </span>
            </label>
          ))}
          {filtered.length > limit && (
            <button onClick={() => setLimit(limit + 100)}>
              Show more expansions
            </button>
          )}
          {!filtered.length && <p>No matching decks.</p>}
        </div>
        <details>
          <summary>Review selected decks ({packs.length})</summary>
          <ul>
            {catalog.packs
              .filter((p) => selected.has(p.id))
              .map((p) => (
                <li key={p.id}>
                  {p.name}{" "}
                  <button
                    aria-label={`Remove ${p.name}`}
                    onClick={() => toggle(p.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
          </ul>
        </details>
        <p className="cg-note">
          Each match draws randomly from the full selection, removes duplicates,
          and prepares up to 2,000 answers and 250 prompts. Special pack
          mechanics and image-only cards are not implemented. These decks are
          not screened for stream suitability.
        </p>
        <details>
          <summary>Card sources and permissions</summary>
          <p>{catalog.rights}</p>
          <p>
            Cards Against Humanity is a trademark of its owner. This is an
            independent game mode. Source: {catalog.source}. API: {catalog.api}.
            Snapshot: {catalog.fetchedAt?.slice(0, 10)}.
          </p>
        </details>
      </section>
      <section>
        <Rules value={rules} onChange={setRules} disabled={busy} />
        <p>
          Default play: ten-card hands, ordered answers, anonymous judging, one
          point per win, and a rotating judge. The score, timer, and round limit
          are adjustable house rules.
        </p>
        <button
          className="cg-primary"
          disabled={busy || !packs.length}
          onClick={onCreate}
        >
          {busy
            ? "Preparing the table…"
            : "Open lobby with these decks and rules"}
        </button>
        <p className="cg-note">
          Opening a lobby makes the game available to viewers. It does not post
          to chat or change your other overlay objects.
        </p>
      </section>
    </div>
  );
}
export function CardTable({ game, busy, act, isHost }) {
  const [selected, setSelected] = useState([]),
    [rules, setRules] = useState(game.rules),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    setSelected([]);
  }, [game.id, game.round, game.submitted]);
  const savedRules = JSON.stringify(game.rules);
  useEffect(() => {
    setRules(JSON.parse(savedRules));
  }, [savedRules]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const judge = game.players.find((p) => p.id === game.judge),
    mine = game.players.find((p) => p.id === game.me),
    remaining = game.deadline
      ? Math.max(0, Math.ceil((game.deadline - now) / 1000))
      : null;
  const toggle = (id) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length < (game.prompt?.pick || 1)
          ? [...current, id]
          : current,
    );
  return (
    <>
      <div className="cg-status">
        <b>
          {game.phase === "lobby"
            ? "Lobby open"
            : game.phase === "finished"
              ? "Match finished"
              : `Round ${game.round} / ${game.rules.roundLimit}`}
        </b>
        <span>
          {judge ? `${judge.name} is judging` : "Waiting for players"}
          {remaining !== null ? ` · ${remaining}s left` : ""}
        </span>
      </div>
      <div className="cg-scoreboard">
        {game.players.map((p) => (
          <span key={p.id}>
            <b>
              {p.name}
              {p.id === game.me ? " (you)" : ""}
            </b>{" "}
            {p.score} pts{" "}
            {isHost && p.name !== "Streamer" && (
              <button
                disabled={busy}
                aria-label={`Remove ${p.name} from game`}
                onClick={() => act({ type: "kick", player: p.id })}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {!game.me &&
        (game.phase === "lobby" ||
          (game.rules.lateJoin && game.phase === "result")) && (
          <button
            className="cg-primary"
            disabled={busy}
            onClick={() => act({ type: "join" })}
          >
            Join this table
          </button>
        )}
      {game.phase === "lobby" && (
        <>
          <p>
            {game.players.length} / {game.rules.maxPlayers} players. At least
            three are needed. Your answers are private until judging.
          </p>
          {isHost && (
            <>
              <Rules value={rules} onChange={setRules} disabled={busy} />
              <div className="cg-actions">
                <button
                  disabled={busy}
                  onClick={() => act({ type: "rules", rules })}
                >
                  Save rules
                </button>
                <button
                  className="cg-primary"
                  disabled={
                    busy ||
                    game.players.length < 3 ||
                    JSON.stringify(rules) !== JSON.stringify(game.rules)
                  }
                  onClick={() => act({ type: "start" })}
                >
                  Start game
                </button>
              </div>
              <p>Save changed rules before starting.</p>
            </>
          )}
        </>
      )}
      {game.prompt && (
        <div className="cg-prompt">
          <small>
            PROMPT · PICK {game.prompt.pick}
            {game.prompt.draw ? ` · DRAW ${game.prompt.draw}` : ""}
          </small>
          <p>{game.prompt.text}</p>
        </div>
      )}
      {game.phase === "playing" && (
        <>
          <p>
            {game.submissionCount} / {game.players.length - 1} answers
            submitted.
            {game.me === game.judge
              ? " You are the judge this round."
              : game.submitted
                ? " Your answer is locked in."
                : ""}
          </p>
          {mine && game.me !== game.judge && !game.submitted && (
            <>
              <p>
                Choose {game.prompt.pick} card
                {game.prompt.pick === 1 ? "" : "s"} in reading order.
              </p>
              <div className="cg-hand">
                {game.hand.map((card) => (
                  <button
                    disabled={busy || remaining === 0}
                    key={card.id}
                    className={selected.includes(card.id) ? "selected" : ""}
                    aria-pressed={selected.includes(card.id)}
                    onClick={() => toggle(card.id)}
                  >
                    <span>
                      {selected.includes(card.id)
                        ? `Choice ${selected.indexOf(card.id) + 1}`
                        : "ANSWER"}
                    </span>
                    {card.text}
                  </button>
                ))}
              </div>
              <div className="cg-actions">
                <button
                  className="cg-primary"
                  disabled={
                    busy ||
                    selected.length !== game.prompt.pick ||
                    remaining === 0
                  }
                  onClick={() => act({ type: "submit", cards: selected })}
                >
                  Submit answer
                </button>
                {game.rules.redraw && (
                  <button
                    disabled={busy || mine.score < 1 || remaining === 0}
                    onClick={() => act({ type: "redraw" })}
                  >
                    Redraw hand · 1 point
                  </button>
                )}
              </div>
            </>
          )}
          {isHost && (
            <div className="cg-actions">
              <button
                disabled={busy || game.submissionCount < 2}
                onClick={() => act({ type: "reveal" })}
              >
                Reveal submitted answers
              </button>
              <button disabled={busy} onClick={() => act({ type: "skip" })}>
                Skip round
              </button>
            </div>
          )}
          {remaining === 0 && (
            <p>
              Time is up. The streamer can reveal the submitted answers or skip
              this round.
            </p>
          )}
        </>
      )}
      {game.phase === "judging" && (
        <>
          <p>
            {game.me === game.judge
              ? "Pick the funniest answer to award one point."
              : "Waiting for the judge to choose."}
          </p>
          <div className="cg-answers">
            {game.submissions.map((sub, i) => (
              <button
                key={sub.id}
                disabled={busy || game.me !== game.judge}
                onClick={() => act({ type: "judge", submission: sub.id })}
              >
                <small>ANSWER {i + 1}</small>
                {sub.cards.map((text, n) => (
                  <p key={n}>
                    {n + 1}. {text}
                  </p>
                ))}
              </button>
            ))}
          </div>
          {isHost && (
            <button disabled={busy} onClick={() => act({ type: "skip" })}>
              Skip round / absent judge
            </button>
          )}
        </>
      )}
      {game.result && (
        <div className="cg-result">
          <h3>
            {game.result.winner
              ? `${game.players.find((p) => p.id === game.result.winner)?.name || "Player"} wins the round!`
              : game.result.message}
          </h3>
          {game.result.cards?.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </div>
      )}
      {game.phase === "result" && isHost && (
        <button
          className="cg-primary"
          disabled={busy || game.players.length < 3}
          onClick={() => act({ type: "next" })}
        >
          Next round
        </button>
      )}
      {game.phase === "finished" && (
        <h3>
          Final scores are above.{" "}
          {game.rules.winningScore > 0
            ? "The match ends at the score target, round limit, or the last prompt."
            : "The round limit or last prompt ends the match."}
        </h3>
      )}
      <details>
        <summary>Match decks and rules</summary>
        <p>
          {game.deck.white} answers and {game.deck.black} prompts drawn from{" "}
          {game.deck.available.white.toLocaleString()} answers and{" "}
          {game.deck.available.black.toLocaleString()} prompts in the selected
          decks.
        </p>
        <ul>
          {game.deck.packs.map((p) => (
            <li key={p.id}>{p.name}</li>
          ))}
        </ul>
        <p>
          {game.rules.handSize} cards per hand ·{" "}
          {game.rules.winningScore || "No"} point target ·{" "}
          {game.rules.judgeMode} judge · {game.rules.seconds || "No"} second
          limit.
        </p>
      </details>
      <div className="cg-actions">
        {mine && !isHost && (
          <button disabled={busy} onClick={() => act({ type: "leave" })}>
            Leave table
          </button>
        )}
        {isHost && (
          <button disabled={busy} onClick={() => act({ type: "close" })}>
            End game and close table
          </button>
        )}
      </div>
    </>
  );
}
export default function CardGame({
  auth,
  host = false,
  helper,
  onClose,
  request = cardRequest,
}) {
  const [open, setOpen] = useState(host),
    [game, setGame] = useState(null),
    [catalog, setCatalog] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [rules, setRules] = useState({ ...DEFAULT_CARD_RULES }),
    [packs, setPacks] = useState([]);
  const dialog = useRef(null),
    current = useRef(auth),
    generation = useRef(0),
    locked = useRef(false),
    actionEpoch = useRef(0);
  current.current = auth;
  useEffect(() => {
    generation.current++;
    setGame(null);
    setCatalog(null);
    setError("");
    setPacks([]);
    setBusy(false);
    return () => {
      generation.current++;
    };
  }, [auth?.channelId]);
  const accept = (data) =>
    setGame((previous) =>
      !data.game
        ? null
        : previous?.id === data.game.id &&
            previous.revision > data.game.revision
          ? previous
          : data.game,
    );
  useEffect(() => {
    if (!auth?.token) return;
    let stopped = false,
      timer;
    const poll = async () => {
      const epoch = actionEpoch.current;
      try {
        if (!document.hidden && !locked.current) {
          const data = await request(auth, "game");
          if (!stopped && epoch === actionEpoch.current) accept(data);
        }
      } catch (e) {
        if (!stopped && open && epoch === actionEpoch.current)
          setError(e.message);
      } finally {
        if (!stopped) timer = setTimeout(poll, open ? 4000 : 20000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [auth?.channelId, auth?.token, open, request]);
  useEffect(() => {
    if (!host || !auth?.token) return;
    let active = true;
    request(auth, "catalog")
      .then((data) => {
        if (active) setCatalog(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [host, auth?.channelId, auth?.token, request]);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [open]);
  const close = () => {
    setOpen(false);
    onClose?.();
  };
  const act = async (action) => {
    if (locked.current) return;
    if (!auth?.token) {
      setError("Open the configuration through Twitch to start a shared game.");
      return;
    }
    if (helper?.viewer && !helper.viewer.isLinked) {
      helper.actions.requestIdShare();
      setError("Share your Twitch identity, then try again.");
      return;
    }
    const token = generation.current;
    const requestAuth = current.current;
    actionEpoch.current++;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      if (action.type === "create") {
        const deck = await prepareCardDeck(
          catalog,
          action.packs,
          (i) => {
            if (token !== generation.current) throw Error("Channel changed.");
            return request(requestAuth, `shard-${i}?v=${catalog.version}`);
          },
          (done, total) => {
            if (token === generation.current)
              setProgress(`Preparing selected decks: ${done} / ${total}`);
          },
        );
        if (token !== generation.current) return;
        action = { ...action, deck };
      }
      const data = await request(requestAuth, "game", {
        ...action,
        gameId: game?.id,
        revision: game?.revision,
      });
      if (token === generation.current) accept(data);
    } catch (e) {
      if (token === generation.current) {
        setError(e.message);
        try {
          const fresh = await request(requestAuth, "game");
          if (token === generation.current) accept(fresh);
        } catch {
          /* Keep the action error visible. */
        }
      }
    } finally {
      locked.current = false;
      if (token === generation.current) {
        setBusy(false);
        setProgress("");
      }
    }
  };
  if (!host && !game && !open) return null;
  return (
    <>
      {!open && game && (
        <button className="cg-launcher" onClick={() => setOpen(true)}>
          ♠ Card table · {game.players.length} players
        </button>
      )}
      {open && (
        <dialog
          className="cg-dialog"
          ref={dialog}
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
          aria-label="Stream card game"
        >
          <header>
            <div>
              <small>SCENE STUDIO · GAME NIGHT</small>
              <h2>Cards with your community</h2>
            </div>
            <button onClick={close} aria-label="Close card game window">
              ×
            </button>
          </header>
          <div className="cg-body">
            {error && (
              <p className="cg-error" role="alert">
                {error}
              </p>
            )}
            {progress && <p role="status">{progress}</p>}
            {!auth?.token && (
              <p>
                Open this screen from your Twitch extension configuration to
                load the deck catalog and host a game.
              </p>
            )}
            {game ? (
              <CardTable
                game={game}
                busy={busy}
                act={act}
                isHost={host && game.isHost}
              />
            ) : host && catalog ? (
              <Setup
                catalog={catalog}
                rules={rules}
                setRules={setRules}
                packs={packs}
                setPacks={setPacks}
                busy={busy}
                onCreate={() =>
                  act({
                    type: "create",
                    rules,
                    packs,
                    catalogVersion: catalog.version,
                  })
                }
              />
            ) : auth?.token ? (
              <p>
                {host
                  ? "Loading the card catalog…"
                  : "The streamer has closed the table."}
              </p>
            ) : null}
            <footer>
              Independent card-game mode. Card text belongs to its respective
              authors. No purchases, paid entries, or paid advantages.
            </footer>
          </div>
        </dialog>
      )}
    </>
  );
}
