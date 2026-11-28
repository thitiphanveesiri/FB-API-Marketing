"use client";
import { useEffect, useRef, useState } from "react";
import { answer, HELP } from "@/lib/chatbot";
import { ANCHOR } from "@/lib/dates";
import { useStore } from "@/lib/store";

interface Msg { from: "me" | "bot"; text: string }

/** Floating chat at the bottom right. Answers come from the data already on the page (see lib/chatbot.ts). */
export default function ChatWidget() {
  const { data } = useStore();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([{ from: "bot", text: HELP }]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, open]);

  const send = async () => {
    const q = text.trim(); if (!q) return;
    setText("");
    const first = answer(q, data, ANCHOR);
    if (first !== HELP) { setMsgs((m) => [...m, { from: "me", text: q }, { from: "bot", text: first }]); return; }
    // the keyword rules could not place it: let the AI rephrase it (only the question text leaves the browser), then answer with the same rules
    setMsgs((m) => [...m, { from: "me", text: q }, { from: "bot", text: "กำลังคิด…" }]);
    let reply = HELP;
    try {
      const j = (await (await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) })).json()) as { text?: string | null };
      if (j.text) reply = answer(j.text, data, ANCHOR);
    } catch { /* no AI: show the examples */ }
    setMsgs((m) => [...m.slice(0, -1), { from: "bot", text: reply }]);
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {open && (
        <div role="dialog" aria-label="ถามข้อมูล" className="flex h-[28rem] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
          <div className="bg-brand px-4 py-2.5 text-sm font-semibold text-white">ถามข้อมูลแอดและเซลล์</div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
            {msgs.map((m, i) => (
              <div key={i} className={m.from === "me" ? "flex justify-end" : "flex"}>
                <p className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 ${m.from === "me" ? "bg-brand text-white" : "bg-brand-faint text-ink"}`}>{m.text}</p>
              </div>
            ))}
            <div ref={end} />
          </div>
          <form className="flex gap-2 border-t border-line p-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="พิมพ์คำถาม…" aria-label="คำถาม" className="min-w-0 flex-1 rounded-full border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand" />
            <button type="submit" className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">ส่ง</button>
          </form>
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? "ปิดแชท" : "เปิดแชทถามข้อมูล"} aria-expanded={open}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-xl text-white shadow-pop hover:bg-brand-hover">{open ? "×" : "💬"}</button>
    </div>
  );
}
