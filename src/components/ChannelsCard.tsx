"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Plug } from "lucide-react";
import { Badge, Btn, Card, Select } from "@/components/ui";
import { useStore } from "@/lib/store";

interface Ch { channelId: string; channel: string; accountId: string; name: string; sheetPageId: string; active: boolean; hasToken: boolean; tokenTail: string; hasSecret: boolean; verifyToken: string }
const inp = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm font-mono";

function CopyBox({ label, value }: { label: string; value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div><span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <div className="flex gap-2"><input readOnly value={value} className={inp} onFocus={(e) => e.currentTarget.select()} />
        <Btn size="sm" className="shrink-0 whitespace-nowrap" onClick={() => { navigator.clipboard?.writeText(value).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => undefined); }}>{ok ? <Check size={14} /> : <Copy size={14} />} {ok ? "คัดลอกแล้ว" : "คัดลอก"}</Btn></div></div>
  );
}

/** Administrators only: connect chat channels with an access token (stored in the Google Sheet) and a webhook. */
export default function ChannelsCard() {
  const { data, user, reloadData, toast } = useStore();
  const [list, setList] = useState<Ch[] | null>(null); const [hook, setHook] = useState("");
  const [token, setToken] = useState(""); const [secret, setSecret] = useState(""); const [pageId, setPageId] = useState("");
  const [editing, setEditing] = useState<string | null>(null); // channelId being updated, "" = new
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const admin = user.role === "Administrator";

  const load = useCallback(async () => {
    try { const j = await (await fetch("/api/channels", { cache: "no-store" })).json(); if (j.ok) { setList(j.channels); setHook(j.webhookUrls.facebook); } else setList([]); } catch { setList([]); }
  }, []);
  useEffect(() => { if (admin) void load(); }, [admin, load]);
  useEffect(() => { if (!pageId) setPageId(data.pages.find((p) => p.active)?.id ?? ""); }, [data.pages, pageId]);
  if (!admin || list === null) return null;

  const fb = list.filter((c) => c.channel === "facebook" && c.active && c.hasToken);
  const form = editing !== null || fb.length === 0;

  const save = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "facebook", channelId: editing || undefined, accessToken: token, appSecret: secret, sheetPageId: pageId }) });
      const j = await r.json().catch(() => ({ ok: false, message: "ตอบกลับไม่ถูกต้อง" }));
      if (!j.ok) { setMsg(j.message || "บันทึกไม่สำเร็จ"); return; }
      setToken(""); setSecret(""); setEditing(null); await load(); await reloadData(true);
      toast(j.subscribed === false ? `เชื่อมเพจ ${j.name || ""} แล้ว แต่สมัครรับแชทอัตโนมัติไม่สำเร็จ: ${j.subscribeMessage}` : `เชื่อมเพจ ${j.name || ""} แล้ว`, j.subscribed === false ? "info" : undefined);
    } catch { setMsg("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ"); } finally { setBusy(false); }
  };
  const disconnect = async (c: Ch) => {
    if (!window.confirm(`ยกเลิกการเชื่อมต่อเพจ ${c.name || c.accountId}? ระบบจะลบ Token ออกจากชีต`)) return;
    setBusy(true);
    try { await fetch("/api/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "disconnect", channelId: c.channelId }) }); await load(); } finally { setBusy(false); }
  };

  return (
    <Card title="เชื่อมช่องทางแชท" subtitle="ใส่ Access Token + ตั้ง Webhook แล้วข้อความจะเข้าระบบอัตโนมัติ เพื่อคำนวณ SLA">
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-brand-2 bg-brand-faint p-3 text-sm"><b>Facebook Messenger</b><div className="mt-1 text-xs text-muted">{fb.length ? `เชื่อมแล้ว ${fb.length} เพจ` : "ยังไม่ได้เชื่อม"}</div></div>
          <div className="rounded-xl border border-line p-3 text-sm text-muted"><b>LINE</b> <Badge>เร็วๆ นี้</Badge></div>
          <div className="rounded-xl border border-line p-3 text-sm text-muted"><b>WhatsApp</b> <Badge>เร็วๆ นี้</Badge></div>
        </div>

        {fb.map((c) => (
          <div key={c.channelId} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
            <Plug size={14} className="text-brand" /><b>{c.name || c.accountId}</b><span className="text-xs text-muted">Token …{c.tokenTail} · เก็บในเพจ {data.pages.find((p) => p.id === c.sheetPageId)?.name ?? c.sheetPageId}</span>
            {!c.hasSecret && <Badge tone="red">ยังไม่มี App Secret</Badge>}
            <span className="ml-auto flex gap-2"><Btn size="sm" onClick={() => { setEditing(c.channelId); setPageId(c.sheetPageId || pageId); }}>แก้ไข</Btn><Btn size="sm" onClick={() => disconnect(c)} disabled={busy}>ยกเลิกการเชื่อม</Btn></span>
          </div>))}

        {form ? (
          <div className="max-w-xl space-y-3 rounded-xl border border-line p-3">
            <h3 className="text-sm font-semibold">{editing ? "แก้ไขการเชื่อมต่อ Facebook" : "เชื่อมเพจ Facebook"}</h3>
            <label className="block text-xs font-medium text-muted">Page Access Token{editing ? " (เว้นว่าง = ใช้ตัวเดิม)" : ""}
              <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAB…" className={`${inp} mt-1`} /></label>
            <label className="block text-xs font-medium text-muted">App Secret (Meta App → Settings → Basic){editing ? " (เว้นว่าง = ใช้ตัวเดิม)" : ""}
              <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} className={`${inp} mt-1`} /></label>
            <Select label="เก็บแชทเข้าเพจในระบบ" value={pageId} onChange={setPageId} options={data.pages.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} />
            {msg && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{msg}</p>}
            <div className="flex gap-2"><Btn variant="primary" onClick={save} disabled={busy || (!editing && !token)}>{busy ? "กำลังตรวจสอบ…" : "บันทึกและเชื่อมต่อ"}</Btn>{editing !== null && <Btn onClick={() => { setEditing(null); setMsg(""); }}>ยกเลิก</Btn>}</div>
            <p className="text-xs text-amber-700">⚠ Token และ App Secret จะถูกเก็บในแท็บ <b>channels</b> ของ Google Sheet — ใครก็ตามที่เปิดชีตได้จะเห็น ควรตั้งการแชร์ชีตเป็น “จำกัด” (Restricted) เฉพาะคนที่ไว้ใจ ระบบจะไม่ส่งค่าเหล่านี้กลับมาที่เบราว์เซอร์</p>
          </div>
        ) : <Btn size="sm" onClick={() => { setEditing(""); }}>+ เชื่อมเพจเพิ่ม</Btn>}

        {fb.length > 0 && (
          <div className="max-w-xl space-y-3 rounded-xl bg-gray-50 p-3">
            <h3 className="text-sm font-semibold">ตั้งค่า Webhook ที่ Meta (ทำครั้งเดียว)</h3>
            <CopyBox label="Callback URL" value={hook} />
            <CopyBox label="Verify Token" value={fb[0].verifyToken} />
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
              <li>developers.facebook.com → แอปของคุณ → <b>Messenger → Settings → Webhooks</b> (หรือ Webhooks → Page)</li>
              <li>กด <b>Add Callback URL</b> วาง Callback URL กับ Verify Token ด้านบน แล้ว Verify and Save</li>
              <li>ติ๊ก subscribe ฟิลด์ <b>messages</b> และ <b>message_echoes</b> (echoes = ข้อความที่เซลล์ตอบ)</li>
              <li>ทดสอบ: ให้ใครสักคนส่งข้อความหาเพจ แล้วดูว่าขึ้นในหน้า Inbox ภายในไม่กี่วินาที</li>
            </ol>
            <p className="text-xs text-muted">Webhook ได้เฉพาะข้อความ “ตั้งแต่ตอนนี้เป็นต้นไป” — ของเก่าใช้ปุ่มดึงย้อนหลังด้านล่าง</p>
          </div>)}
      </div>
    </Card>
  );
}
