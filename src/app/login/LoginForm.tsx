"use client";
import { useState } from "react";

export function LoginForm({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: f.get("username"), password: f.get("password"), next }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; next?: string };
      if (r.ok && j.ok) { window.location.assign(j.next || "/"); return; }
      setError(j.message || "เข้าสู่ระบบไม่สำเร็จ");
    } catch { setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง"); }
    setBusy(false);
  }
  const input = "mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";
  return (
    <form onSubmit={submit} className="mt-5 space-y-3">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <label className="block text-sm font-medium">ชื่อผู้ใช้<input name="username" autoComplete="username" autoCapitalize="none" required className={input} /></label>
      <label className="block text-sm font-medium">รหัสผ่าน<input name="password" type="password" autoComplete="current-password" required className={input} /></label>
      <button disabled={busy} className="h-11 w-full rounded-lg bg-brand text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-60">{busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button>
      <p className="text-xs text-muted">ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบ (Administrator) เพื่อตั้งรหัสใหม่</p>
    </form>
  );
}
