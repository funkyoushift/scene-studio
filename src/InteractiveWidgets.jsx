import React, { useEffect, useRef, useState } from "react";
import "./widgets.css";

export function InteractiveWidget({ object, count = 0, onCount, onComplete, editing = false }) {
  const [selected, setSelected] = useState(null);
  const completed = useRef(false);
  const quizCompleted = useRef(false);
  const choicesKey = JSON.stringify(object?.quiz?.choices ?? []);

  useEffect(() => {
    setSelected(null);
    quizCompleted.current = false;
  }, [object?.id, object?.title, choicesKey, object?.quiz?.correctIndex, object?.detail]);

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
