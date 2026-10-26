import test from "node:test";
import assert from "node:assert/strict";
import { TRIVIA_CATEGORIES, TRIVIA_QUESTIONS, TRIVIA_SOURCE, createTriviaDeck, getTriviaQuestions } from "../src/trivia-bank.mjs";

function seeded(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
}

test("bundled categories have a large, concise, complete attributed bank", () => {
  assert.equal(TRIVIA_CATEGORIES[0].id, "mixed");
  assert.equal(TRIVIA_CATEGORIES.length, 25);
  assert.ok(TRIVIA_QUESTIONS.length >= 400);
  assert.equal(new Set(TRIVIA_CATEGORIES.map(item => item.id)).size, TRIVIA_CATEGORIES.length);
  for (const category of TRIVIA_CATEGORIES.slice(1)) assert.ok(getTriviaQuestions(category.id).length > 0, category.id);
  assert.equal(TRIVIA_SOURCE.license, "CC BY-SA 4.0");
  assert.ok(TRIVIA_SOURCE.url);
  assert.ok(new Set(TRIVIA_QUESTIONS.map(item => item.question.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())).size === TRIVIA_QUESTIONS.length, "question text should be deduplicated");
  for (const item of TRIVIA_QUESTIONS) {
    assert.ok(item.question.length <= 160, item.question);
    assert.ok(item.choices.length >= 2 && item.choices.length <= 4);
    assert.ok(item.choices.every(choice => choice.length <= 80));
    assert.ok(typeof item.explanation === "string");
  }
});

test("deck shuffles choices and remaps curated and imported correct answers", () => {
  const category = "opentdb-17";
  const original = new Map(getTriviaQuestions(category).map(item => [item.id, item]));
  const deck = createTriviaDeck(category, seeded(17));
  assert.equal(deck.length, original.size);
  for (const item of deck) {
    const source = original.get(item.id);
    assert.deepEqual([...item.choices].sort(), [...source.choices].sort());
    assert.equal(item.choices[item.correctIndex], source.choices[source.correctIndex]);
  }
  assert.notDeepEqual(deck.map(item => item.id), [...original.keys()]);
});

test("each deck contains every eligible question once, then a fresh deck can begin", () => {
  const first = createTriviaDeck("opentdb-22", seeded(42));
  const second = createTriviaDeck("opentdb-22", seeded(99));
  assert.equal(new Set(first.map(item => item.id)).size, first.length);
  assert.deepEqual(new Set(first.map(item => item.id)), new Set(second.map(item => item.id)));
  assert.notDeepEqual(first.map(item => item.id), second.map(item => item.id));
  assert.ok(createTriviaDeck("mixed", seeded(3)).every(item => item.category));
});
