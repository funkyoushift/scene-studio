export const EDITOR_THEME_KEY = "scene-studio-editor-theme";
export const EDITOR_THEMES = Object.freeze(["dark", "light"]);

export function normalizeEditorTheme(value) {
  return EDITOR_THEMES.includes(value) ? value : "dark";
}

export function readEditorTheme(storage) {
  try {
    storage ??= globalThis.localStorage;
    return normalizeEditorTheme(storage?.getItem(EDITOR_THEME_KEY));
  } catch {
    return "dark";
  }
}

export function writeEditorTheme(theme, storage) {
  const normalized = normalizeEditorTheme(theme);
  try {
    storage ??= globalThis.localStorage;
    storage?.setItem(EDITOR_THEME_KEY, normalized);
  } catch {
    // Theme selection still works for this session when storage is unavailable.
  }
  return normalized;
}
