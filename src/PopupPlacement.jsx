import React, { useRef } from "react";
import "./popup-placement.css";

const DEFAULT_LAYOUT = Object.freeze({ x: 58, y: 5, width: 39, height: 80, layer: 0 });

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export default function PopupPlacement({ carousel, onChange }) {
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const layout = { ...DEFAULT_LAYOUT, ...(carousel?.layout || {}) };
  const slide = carousel?.slides?.[0];

  function moveTo(x, y) {
    onChange?.({ ...layout, x: clamp(x, 0, Math.min(90, 100 - layout.width)), y: clamp(y, 0, Math.min(90, 100 - layout.height)) });
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: layout.x, startY: layout.y };
  }

  function onPointerMove(event) {
    const drag = dragRef.current;
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !bounds?.width || !bounds?.height) return;
    moveTo(drag.startX + (event.clientX - drag.x) / bounds.width * 100, drag.startY + (event.clientY - drag.y) / bounds.height * 100);
  }

  function onPointerEnd(event) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function onKeyDown(event) {
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const amount = event.shiftKey ? 5 : 1;
    moveTo(layout.x + step[0] * amount, layout.y + step[1] * amount);
  }

  return <section className="popup-placement" aria-label="Popup placement">
    <div className="popup-placement-heading"><h3>Popup placement</h3><p>Drag to position · arrow keys to nudge</p></div>
    <div className="popup-placement-stage" ref={stageRef}>
      <div className="popup-placement-stream" aria-hidden="true"><span>STREAM PREVIEW</span><i /><i /><i /><b /></div>
      <button
        type="button"
        className="popup-placement-card"
        aria-label="Move popup"
        title="Drag to move. Use arrow keys to nudge; hold Shift to move farther."
        style={{ left: `${layout.x}%`, top: `${layout.y}%`, width: `${layout.width}%`, height: `${layout.height}%`, zIndex: layout.layer }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        {slide?.image && <img className="popup-placement-image" src={slide.image} alt="" draggable="false" />}
        <span className="popup-placement-title">{slide?.title || "Your carousel"}</span>
        {slide?.caption && <span className="popup-placement-caption">{slide.caption}</span>}
      </button>
    </div>
  </section>;
}
