import React, { useEffect, useRef, useState } from "react";
import { readEditorTheme, writeEditorTheme } from "./editor-theme.mjs";

const THEME_CHANGE_EVENT = "scene-studio:editor-theme-change";

export default function ThemeToggle() {
  const [theme, setTheme] = useState(readEditorTheme);
  const buttonRef = useRef(null);

  useEffect(() => {
    buttonRef.current?.closest(".app-shell, .director, .experience-home")?.setAttribute("data-editor-theme", theme);
  }, [theme]);

  useEffect(() => {
    const syncTheme = event => {
      const next = event.type === "storage" ? readEditorTheme() : event.detail;
      if (next === "dark" || next === "light") setTheme(next);
    };
    window.addEventListener(THEME_CHANGE_EVENT, syncTheme);
    window.addEventListener("storage", syncTheme);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
      window.removeEventListener("storage", syncTheme);
    };
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    writeEditorTheme(next);
    buttonRef.current?.closest(".app-shell, .director, .experience-home")?.setAttribute("data-editor-theme", next);
    setTheme(next);
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: next }));
  }

  return <button ref={buttonRef} className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} aria-pressed={theme === "dark"}>
    {theme === "dark" ? "Dark" : "Light"}
  </button>;
}
