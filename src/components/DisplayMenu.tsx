"use client";
import { useRef, useState, useEffect } from "react";
import { Monitor, Moon, Palette, Sun, Leaf } from "lucide-react";
import { Density, Size, Theme, setPrefs, usePrefs } from "@/lib/prefs";
import { cn } from "./ui";

const THEMES: { id: Theme; label: string; hint: string; icon: typeof Sun }[] = [
  { id: "soft", label: "Soft", hint: "Low-glare, recommended", icon: Leaf },
  { id: "light", label: "Light", hint: "Bright and crisp", icon: Sun },
  { id: "dark", label: "Dark", hint: "Night / low light", icon: Moon },
  { id: "system", label: "Auto", hint: "Follow device", icon: Monitor },
];

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">{label}</p>
      <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)}
            className={cn("h-8 flex-1 border-r border-line px-2 text-xs font-medium last:border-r-0", value === o.id ? "bg-brand text-white" : "bg-surface text-ink hover:bg-gray-50")}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

export default function DisplayMenu() {
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-label="Display settings" aria-expanded={open} className="rounded-lg p-2 text-muted hover:bg-gray-100"><Palette size={18} /></button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 space-y-3 rounded-xl border border-line bg-surface p-3 shadow-pop">
          <p className="text-sm font-semibold">Display</p>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Theme</p>
            <div className="grid grid-cols-2 gap-1.5">
              {THEMES.map((t) => { const Icon = t.icon; const on = prefs.theme === t.id; return (
                <button key={t.id} aria-pressed={on} onClick={() => setPrefs({ theme: t.id })}
                  className={cn("flex items-center gap-2 rounded-lg border p-2 text-left", on ? "border-brand-2 bg-brand-faint" : "border-line hover:bg-gray-50")}>
                  <Icon size={16} className={on ? "text-brand" : "text-muted"} />
                  <span><span className="block text-sm font-medium leading-tight">{t.label}</span><span className="block text-[10px] leading-tight text-muted">{t.hint}</span></span>
                </button>); })}
            </div>
          </div>
          <Seg<Size> label="Text size" value={prefs.size} onChange={(v) => setPrefs({ size: v })} options={[{ id: "normal", label: "Normal" }, { id: "large", label: "Large" }]} />
          <Seg<Density> label="Table density" value={prefs.density} onChange={(v) => setPrefs({ density: v })} options={[{ id: "comfortable", label: "Comfortable" }, { id: "compact", label: "Compact" }]} />
          <p className="text-[11px] text-muted">Saved on this device. Animations are off automatically if your system asks for reduced motion.</p>
        </div>
      )}
    </div>
  );
}
