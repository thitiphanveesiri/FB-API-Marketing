// Part B of the chat helper: when keyword rules cannot place a question, a small Gemini model REWRITES it into a form the rules understand.
// It never sees customer data and never produces numbers: only the question text (phones/emails removed) and the business names
// of ads, pages and sales reps. The answer is still computed by lib/chatbot.ts.
const FORMS = [
  "ภาพรวมแอดทั้งหมด <ช่วงเวลา>",
  "แอด <ชื่อแอด> <ช่วงเวลา>",
  "เพจ <ชื่อเพจ> ยิงแอดไปเท่าไหร่ <ช่วงเวลา>",
  "เซลล์คนไหนตอบช้า / ตอบเร็ว / ปิดการขายได้ <ช่วงเวลา>",
  "แอดที่ใช้เงินมากกว่า <ตัวเลข> <ช่วงเวลา> (หรือ น้อยกว่า)",
  "แอดไหนต้นทุนต่อแชทน้อยที่สุด <ช่วงเวลา>",
];

export const redact = (q: string) => q.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, " ").replace(/\+?\d[\d\s-]{6,}\d/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);

export function prompt(names: { ads: string[]; pages: string[]; reps: string[] }): string {
  const list = (xs: string[]) => xs.slice(0, 80).join(" | ") || "-";
  return [
    "Rewrite the user's question into ONE short Thai sentence in exactly one of these forms. Reply with the sentence only.",
    ...FORMS.map((f) => `- ${f}`),
    "<ช่วงเวลา> is one of: วันนี้, เมื่อวาน, 7 วัน, 30 วัน, เดือนนี้, เดือนที่แล้ว. Use names only from the lists, spelled exactly.",
    `Ads: ${list(names.ads)}`, `Pages: ${list(names.pages)}`, `Sales reps: ${list(names.reps)}`,
    "If the question is not about ads, pages or sales reps, reply exactly NONE.",
  ].join("\n");
}

/** Returns the rewritten question, or null when the model cannot place it / the call fails. */
export async function rewrite(question: string, names: Parameters<typeof prompt>[0], key: string, doFetch: typeof fetch = fetch): Promise<string | null> {
  const q = redact(question); if (!q) return null;
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const r = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: prompt(names) }] }, contents: [{ role: "user", parts: [{ text: q }] }], generationConfig: { temperature: 0, maxOutputTokens: 120 } }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const out = (j.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim().split("\n")[0].slice(0, 200);
  return !out || /^none\b/i.test(out) ? null : out;
}
