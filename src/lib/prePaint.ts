// Server-safe (no "use client"): imported by app/layout.tsx.
export const PREFS_KEY = "mid-display-prefs";
/** Runs before first paint so the saved theme never flashes. Keep in sync with applyPrefs() in prefs.ts. */
export const PRE_PAINT_SCRIPT = `(function(){try{var d={theme:"soft",size:"normal",density:"comfortable"};var s=JSON.parse(localStorage.getItem("${PREFS_KEY}")||"{}");var p=Object.assign(d,s);var t=p.theme==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"soft"):p.theme;var e=document.documentElement;e.dataset.theme=t;e.dataset.size=p.size;e.dataset.density=p.density;}catch(x){}})();`;
