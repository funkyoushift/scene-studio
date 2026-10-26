import React, { useEffect, useRef, useState } from "react";
import "./widgets.css";
import { createTriviaDeck, getTriviaQuestions, TRIVIA_CATEGORIES, TRIVIA_SOURCE } from "./trivia-bank.mjs";

export function InteractiveWidget({ object, count = 0, onCount, onComplete, editing = false }) {
  const [selected, setSelected] = useState(null);
  const completed = useRef(false);
  const quizCompleted = useRef(false);
  const triviaRef = useRef(null);
  const choicesKey = JSON.stringify(object?.quiz?.choices ?? []);
  const bankMode = object?.quiz?.mode === "bank";
  const bankCategory = object?.quiz?.category ?? "mixed";
  const bankKey = `${object?.id ?? ""}:${object?.title ?? ""}:${bankMode}:${bankCategory}`;
  const [bank, setBank] = useState(() => ({ key: bankKey, deck: bankMode ? createTriviaDeck(bankCategory) : [], index: 0, score: 0 }));
  if (bank.key !== bankKey) setBank({ key: bankKey, deck: bankMode ? createTriviaDeck(bankCategory) : [], index: 0, score: 0 });
  const activeBank = bank;

  useEffect(() => {
    setSelected(null);
    quizCompleted.current = false;
  }, [object?.id, object?.title, choicesKey, object?.quiz?.correctIndex, object?.quiz?.mode, bankCategory, object?.detail]);

  useEffect(() => {
    if (editing) return;
    if (!object?.goal || count < object.goal) {
      completed.current = false;
      return;
    }
    if (!completed.current) {
      completed.current = true;
      onComplete?.();
    }
  }, [count, object?.goal, onComplete, editing]);

  if (object?.quiz) {
    if (bankMode) {
      const question = activeBank.deck[activeBank.index];
      const isCorrect = selected === question?.correctIndex;
      const questionsInCategory = getTriviaQuestions(bankCategory).length;
      const nextQuestion = event => {
        event.stopPropagation();
        if (activeBank.index + 1 >= activeBank.deck.length) {
          setBank({ ...activeBank, deck: createTriviaDeck(bankCategory), index: 0 });
        } else setBank({ ...activeBank, index: activeBank.index + 1 });
        quizCompleted.current = false;
        setSelected(null);
        requestAnimationFrame(() => {
          const scrollBox = triviaRef.current?.closest(".scene-object.interactive-object");
          if (scrollBox) scrollBox.scrollTop = 0;
        });
      };
      return <section ref={triviaRef} className={"interactive-widget widget-trivia-bank" + (editing ? " is-editing" : "")} aria-label={"Random trivia: " + object.title}>
        {editing ? <><p className="interactive-widget-preview">Random trivia · {TRIVIA_CATEGORIES.find(item => item.id === bankCategory)?.label ?? "Mixed"} · {questionsInCategory} bundled questions</p><div className="widget-trivia-preview-card"><strong>Ready to play</strong><span>Questions and answers are shuffled for each round.</span><span>Score is personal to this viewer and visit.</span></div></> : <>
          <p className="widget-trivia-score">Your score this visit: {activeBank.score}</p>
          <fieldset className="widget-quiz" disabled={selected !== null}>
            <legend>{question?.question}</legend>
            {question?.choices.map((choice, index) => <button key={choice} type="button" className="widget-choice" onClick={event => {
              event.stopPropagation(); setSelected(index);
              if (index === question.correctIndex && !quizCompleted.current) {
                quizCompleted.current = true;
                setBank(current => ({ ...current, score: current.score + 1 }));
                onComplete?.();
              }
            }}>{choice}</button>)}
          </fieldset>
          <small className="widget-trivia-attribution">Includes questions from {TRIVIA_SOURCE.name} · {TRIVIA_SOURCE.license}</small>
          {selected !== null && <div className="widget-feedback" role="status">
            <strong>{isCorrect ? "That’s right!" : "Not quite."}</strong>
            {question.explanation && <p>{question.explanation}</p>}
            {!isCorrect && <p>Correct answer: {question.choices[question.correctIndex]}</p>}
            <button type="button" className="widget-retry" onClick={nextQuestion}>Next question</button>
          </div>}
        </>}
      </section>;
    }
    const { choices, correctIndex } = object.quiz;
    const isCorrect = selected === correctIndex;
    return <section className={"interactive-widget" + (editing ? " is-editing" : "")} aria-label={"Quiz: " + object.title}>
      {editing ? <p className="interactive-widget-preview">Quiz · {choices.length} answer choices</p> : <>
        <fieldset className="widget-quiz" disabled={selected !== null}>
          <legend>{object.title}</legend>
          {choices.map((choice, index) => <button key={index + ":" + choice} type="button" className="widget-choice" onClick={event => {
            event.stopPropagation();
            setSelected(index);
            if (index === correctIndex && !quizCompleted.current) {
              quizCompleted.current = true;
              onComplete?.();
            }
          }}>
            {choice}
          </button>)}
        </fieldset>
        {selected !== null && <div className="widget-feedback" role="status">
          <strong>{isCorrect ? "That’s right!" : "Not quite."}</strong>
          {object.detail && <p>{object.detail}</p>}
          {!isCorrect && <p>Correct answer: {choices[correctIndex]}</p>}
          <button type="button" className="widget-retry" onClick={event => { event.stopPropagation(); setSelected(null); }}>Try again</button>
        </div>}
      </>}
    </section>;
  }

  if (object?.goal) {
    const progress = Math.min(object.goal, Math.max(0, Number.isFinite(count) ? count : 0));
    return <section className={"interactive-widget" + (editing ? " is-editing" : "")} aria-label={object.title + " personal goal"}>
      {editing ? <p className="interactive-widget-preview">Personal goal · {object.goal} taps</p> : <>
        <p className="widget-progress-label">Your progress: {progress} of {object.goal}</p>
        <progress className="widget-progress" value={progress} max={object.goal}>{progress} of {object.goal}</progress>
        {progress >= object.goal
          ? <p className="widget-goal-complete" role="status">Goal reached! This progress is just for you.</p>
          : <button type="button" className="widget-count-button" onClick={event => { event.stopPropagation(); onCount?.(); }}>Add a tap</button>}
      </>}
    </section>;
  }

  return null;
}

export default InteractiveWidget;
