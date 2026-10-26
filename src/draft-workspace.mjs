import { STORAGE_KEY } from "./scene.mjs";

export const AUTOMATION_STORAGE_KEY = "scene-studio-automation-preview-v1";

const SLUG_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export function validDraftSlug(value) {
  return typeof value === "string" && SLUG_PATTERN.test(value) ? value : null;
}

export function draftSlugFromSearch(search, { isViewer = false, isConfig = false } = {}) {
  if (isViewer || isConfig) return null;
  try {
    const values = new URLSearchParams(search).getAll("draft");
    return values.length === 1 ? validDraftSlug(values[0]) : null;
  } catch {
    return null;
  }
}

export function sceneDraftStorageKey(slug) {
  return validDraftSlug(slug) ? `${STORAGE_KEY}:draft:${slug}` : STORAGE_KEY;
}

export function automationDraftStorageKey(slug) {
  return validDraftSlug(slug) ? `${AUTOMATION_STORAGE_KEY}:draft:${slug}` : AUTOMATION_STORAGE_KEY;
}

export function blankDraftScene() {
  return { version: 1, name: "Untitled scene", objects: [] };
}
