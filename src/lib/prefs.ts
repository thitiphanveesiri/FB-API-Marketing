"use client";
import { useSyncExternalStore } from "react";
import { PREFS_KEY as KEY } from "./prePaint";

export type Theme = "soft" | "light" | "dark" | "system";
export type Size = "normal" | "large";
export type Density = "comfortable" | "compact";
export interface Prefs { theme: Theme; size: Size; density: Density }

export const DEFAULTS: Prefs = { theme: "soft", size: "normal", density: "comfortable" };
const listeners = new Set<() => void>();
let cache: Prefs = DEFAULTS;

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch { /* storage blocked: fall back to defaults */ }
  return DEFAULTS;
}
export function resolveTheme(t: Theme): "soft" | "light" | "dark" {
  if (t !== "system") return t;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "soft";
}
export function applyPrefs(p: Prefs) {
  const el = document.documentElement;
  el.dataset.theme = resolveTheme(p.theme);
  el.dataset.size = p.size;
  el.dataset.density = p.density;
}
export function setPrefs(patch: Partial<Prefs>) {
  cache = { ...cache, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  applyPrefs(cache);
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  if (listeners.size === 0) { cache = read(); }
  listeners.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onMq = () => { if (cache.theme === "system") applyPrefs(cache); };
  mq.addEventListener("change", onMq);
  return () => { listeners.delete(cb); mq.removeEventListener("change", onMq); };
}
const getSnapshot = () => cache;
export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS);
}
