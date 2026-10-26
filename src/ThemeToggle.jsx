import React, { useEffect, useRef, useState } from "react";
import { readEditorTheme, writeEditorTheme } from "./editor-theme.mjs";

export default function ThemeToggle() {
  const [theme, setTheme] = useState(readEditorTheme);
  const buttonRef = useRef(null);

  useEffect(() => {
    buttonRef.current?.closest(".app-shell, .director")?.setAttribute("data-editor-theme", theme);
  }, [theme]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    writeEditorTheme(next);
    buttonRef.current?.closest(".app-shell, .director")?.setAttribute("data-editor-theme", next);
    setTheme(next);
  }

  return <button ref={buttonRef} className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} aria-pressed={theme === "dark"}>
    {theme === "dark" ? "Dark" : "Light"}
  </button>;
}
