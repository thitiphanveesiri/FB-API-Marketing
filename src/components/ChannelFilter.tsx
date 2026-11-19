"use client";
import { CHANNELS, ChatChannel } from "@/lib/types";
import { cn, ChannelIcon } from "@/components/ui";

/** Chips that split chats by channel (Facebook / Instagram / LINE / WhatsApp). `counts` = chats per channel in the current view. */
export default function ChannelFilter({ value, onChange, counts, className }: { value: ChatChannel | "all"; onChange: (v: ChatChannel | "all") => void; counts: Record<ChatChannel, number>; className?: string }) {
  const total = CHANNELS.reduce((n, c) => n + counts[c.id], 0);
  const base = "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium";
  return (
    <div className={cn("flex flex-wrap gap-1", className)} role="group" aria-label="ช่องทางแชท">
      <button aria-pressed={value === "all"} onClick={() => onChange("all")} className={cn(base, value === "all" ? "border-brand bg-brand-faint text-brand" : "border-line text-muted hover:bg-gray-50")}>ทุกช่องทาง <span className="opacity-70">{total}</span></button>
      {CHANNELS.map((c) => (
        <button key={c.id} aria-pressed={value === c.id} onClick={() => onChange(c.id)} title={counts[c.id] === 0 && c.id !== "facebook" ? "ช่องทางนี้ยังไม่ได้เชื่อมต่อ" : undefined}
          className={cn(base, value === c.id ? "border-brand bg-brand-faint text-brand" : counts[c.id] === 0 ? "border-line text-gray-400 hover:bg-gray-50" : "border-line text-muted hover:bg-gray-50")}>
          <ChannelIcon id={c.id} size={13} />{c.label} <span className="opacity-70">{counts[c.id]}</span>
        </button>
      ))}
    </div>
  );
}

export const countByChannel = (leads: { channel?: ChatChannel }[]): Record<ChatChannel, number> => {
  const n: Record<ChatChannel, number> = { facebook: 0, instagram: 0, line: 0, whatsapp: 0 };
  for (const l of leads) n[l.channel ?? "facebook"]++;
  return n;
};
