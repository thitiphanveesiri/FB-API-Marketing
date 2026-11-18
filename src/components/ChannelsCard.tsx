"use client";
import { useCallback, useEffect, useState } from "react";
import { Camera, Check, Copy, Plug } from "lucide-react";
import { Badge, Btn, Card, Select } from "@/components/ui";
import { useStore } from "@/lib/store";

interface Ch { channelId: string; channel: string; accountId: string; name: string; sheetPageId: string; forceSheetPage: boolean; active: boolean; hasToken: boolean; tokenTail: string; hasSecret: boolean; verifyToken: string }
interface AdAcct { id: string; name: string; status?: number; currency?: string; connected: boolean }
interface ConnectRes { fbPageId: string; name: string; ok: boolean; message?: string; systemPageId?: string; createdPage?: boolean; subscribed?: boolean; subscribeMessage?: string; instagram?: { id: string; username: string } | null; instagramLookupMessage?: string }
interface ChannelList { channels: Ch[]; webhookUrl: string; verifyToken: string }
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
interface AdsRes { added: number; existing: number; refreshed?: number; names: string[]; message: string }
interface ExtendRes { extended: boolean; days: number | null; note: string }
const adsText = (a: AdsRes) => a.added + a.existing + (a.refreshed ?? 0) > 0
  ? `พบบัญชีโฆษณา ${a.added + a.existing} บัญชี (${a.names.join(", ")})${a.refreshed ? ` · เปลี่ยนโทเคนที่หมดอายุให้ ${a.refreshed} บัญชี` : ""}` : a.message;
/** Did the long-lived swap work? A short-lived token silently dies in 1–2 hours, so a failure here is worth saying out loud. */
const extendText = (e: ExtendRes | null) => !e ? "" : e.extended ? `ต่ออายุโทเคนอัตโนมัติแล้ว${e.days ? ` (~${e.days} วัน)` : ""} — โทเคนเพจที่ได้ไม่หมดอายุ` : e.note;

export default function ChannelsCard() {
  const { data, user, reloadData, toast } = useStore();
  const [list, setList] = useState<Ch[] | null>(null); const [hook, setHook] = useState(""); const [verify, setVerify] = useState("");
  const [choices, setChoices] = useState<{ id: string; name: string }[]>([]); const [fbPageId, setFbPageId] = useState("");
  const [token, setToken] = useState(""); const [secret, setSecret] = useState(""); const [pageId, setPageId] = useState("");
  const [editing, setEditing] = useState<string | null>(null); // channelId being updated, "" = new
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const [adAcct, setAdAcct] = useState(""); const [adToken, setAdToken] = useState(""); const [adForcePage, setAdForcePage] = useState(false); const [adEdit, setAdEdit] = useState(false); const [editingAdChannel, setEditingAdChannel] = useState<string | null>(null); const [adMsg, setAdMsg] = useState("");
  const [adList, setAdList] = useState<AdAcct[] | null>(null); const [adListMsg, setAdListMsg] = useState(""); const [adListBusy, setAdListBusy] = useState(false);
  const [fbDest, setFbDest] = useState(""); const [allToken, setAllToken] = useState(""); const [allSecret, setAllSecret] = useState("");
  const [allBusy, setAllBusy] = useState(false); const [allMsg, setAllMsg] = useState("");
  const [allRes, setAllRes] = useState<{ results: ConnectRes[]; ads: AdsRes | null; extend: ExtendRes | null } | null>(null);
  const admin = user.role === "Administrator";

  const load = useCallback(async (): Promise<ChannelList | null> => {
    try {
      const response = await fetch("/api/channels", { cache: "no-store" });
      if (!response.ok) return null;
      const result = await response.json() as { ok?: boolean; channels?: Ch[]; webhookUrls?: { facebook?: string; instagram?: string }; verifyToken?: string };
      if (!result.ok || !Array.isArray(result.channels)) return null;
      return { channels: result.channels, webhookUrl: result.webhookUrls?.facebook ?? "", verifyToken: result.verifyToken ?? "" };
    } catch { return null; }
  }, []);
  const refresh = useCallback(async () => {
    const result = await load();
    setList(result?.channels ?? []);
    if (result) { setHook(result.webhookUrl); setVerify(result.verifyToken); }
  }, [load]);
  const loadAdAccounts = useCallback(async (accessToken: string) => {
    setAdListBusy(true); setAdListMsg("");
    try {
      const response = await fetch("/api/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "listAds", accessToken }) });
      const result = await response.json().catch(() => ({ ok: false, message: "ตอบกลับไม่ถูกต้อง" }));
      if (!result.ok) { setAdList(null); setAdListMsg(result.message || "ดึงรายการบัญชีโฆษณาไม่สำเร็จ"); return; }
      const accounts = Array.isArray(result.accounts) ? (result.accounts as AdAcct[]) : [];
      setAdList(accounts);
      if (!accounts.length) setAdListMsg(result.message || "โทเคนนี้มองไม่เห็นบัญชีโฆษณา");
    } catch { setAdList(null); setAdListMsg("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ"); } finally { setAdListBusy(false); }
  }, []);
  useEffect(() => {
    if (!admin) return;
    let active = true;
    void load().then((result) => {
      if (!active) return;
      setList(result?.channels ?? []);
      if (result) { setHook(result.webhookUrl); setVerify(result.verifyToken); }
    });
    return () => { active = false; };
  }, [admin, load]);
  const ads = (list ?? []).filter((c) => c.channel === "ads" && c.active && c.hasToken);
  const adForm = adEdit || ads.length === 0;
  if (!admin || list === null) return null;

  const selectedPageId = pageId || data.pages.find((p) => p.active)?.id || "";
  const fb = list.filter((c) => c.channel === "facebook" && c.active && c.hasToken);
  const instagram = list.filter((c) => c.channel === "instagram" && c.active && c.hasToken);
  const form = editing !== null || fb.length === 0;

  const save = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "facebook", channelId: editing || undefined, accessToken: token, appSecret: secret, sheetPageId: fbDest || undefined, fbPageId: fbPageId || undefined }) });
      const j = await r.json().catch(() => ({ ok: false, message: "ตอบกลับไม่ถูกต้อง" }));
      if (!j.ok) { setChoices(Array.isArray(j.pages) ? j.pages : []); setMsg(j.message || "บันทึกไม่สำเร็จ"); return; }
      setChoices([]); setFbPageId(""); setToken(""); setSecret(""); setFbDest(""); setEditing(null); await refresh(); await reloadData(true);
      const ads = j.ads as AdsRes | null, ext = j.extend as ExtendRes | null;
      const adsNote = !ads ? "" : ` · ${adsText(ads)}${ads.added + ads.existing + (ads.refreshed ?? 0) > 0 ? " ดึงพร้อมแชทได้เลย" : ""}`;
      const adsBad = !!ads && ads.added + ads.existing + (ads.refreshed ?? 0) === 0, extNote = extendText(ext) ? ` · ${extendText(ext)}` : "";
      const igNote = j.instagram
        ? ` · พบ Instagram @${j.instagram.username || j.instagram.id}; อย่าลืมเปิด Instagram → messages ใน Meta App Dashboard`
        : j.instagramLookupMessage ? ` · ค้นหา Instagram ไม่สำเร็จ: ${j.instagramLookupMessage}` : "";
      toast((j.subscribed === false ? `เชื่อมเพจ ${j.name || ""} แล้ว แต่สมัครรับแชทอัตโนมัติไม่สำเร็จ: ${j.subscribeMessage}` : `เชื่อมเพจ ${j.name || ""} แล้ว`) + igNote + adsNote + extNote, j.subscribed === false || !!j.instagramLookupMessage || adsBad || (!!ext && !ext.extended) ? "info" : undefined);
    } catch { setMsg("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ"); } finally { setBusy(false); }
  };
  const connectAll = async () => {
    setAllBusy(true); setAllMsg(""); setAllRes(null);
    try {
      const response = await fetch("/api/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "connectAll", accessToken: allToken, appSecret: allSecret }),
      });
      const result = await response.json().catch(() => ({ ok: false, message: "ตอบกลับไม่ถูกต้อง" }));
      if (!result.ok) { setAllMsg(result.message || "เชื่อมไม่สำเร็จ"); return; }
      const connected = (result.results ?? []) as ConnectRes[];
      setAllRes({ results: connected, ads: result.ads ?? null, extend: result.extend ?? null });
      setAllToken(""); setAllSecret("");
      await refresh(); await reloadData(true);
      const successCount = connected.filter((page) => page.ok).length;
      const instagramLookupFailures = connected.filter((page) => !!page.instagramLookupMessage).length;
      toast(`เชื่อมแล้ว ${successCount} เพจ${instagramLookupFailures ? ` · ค้นหา Instagram ไม่สำเร็จ ${instagramLookupFailures} เพจ (สถานะเดิมยังคงอยู่)` : ""}`, successCount === connected.length && !instagramLookupFailures ? undefined : "info");
    } catch { setAllMsg("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ"); } finally { setAllBusy(false); }
  };
  const saveAds = async () => {
    setBusy(true); setAdMsg("");
    try {
      const r = await fetch("/api/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "ads", accountId: adAcct, accessToken: adToken, sheetPageId: selectedPageId, forceSheetPage: adForcePage }) });
      const j = await r.json().catch(() => ({ ok: false, message: "ตอบกลับไม่ถูกต้อง" }));
      if (!j.ok) { setAdMsg(j.message || "บันทึกไม่สำเร็จ"); return; }
      setAdToken(""); setAdAcct(""); setAdEdit(false); setEditingAdChannel(null); await refresh();
      toast(j.mappingUpdated ? `เปลี่ยนเพจปลายทางของ ${j.name || adAcct} แล้ว` : j.currency && j.currency !== "THB" ? `เชื่อมบัญชีโฆษณา ${j.name} แล้ว แต่สกุลเงินเป็น ${j.currency} (ระบบแสดงผลเป็นบาท)` : `เชื่อมบัญชีโฆษณา ${j.name || ""} แล้ว`, j.currency && j.currency !== "THB" ? "info" : undefined);
    } catch { setAdMsg("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ"); } finally { setBusy(false); }
  };
  const disconnect = async (c: Ch) => {
    if (!window.confirm(`ยกเลิกการเชื่อมต่อเพจ ${c.name || c.accountId}? ระบบจะลบ Token ออกจากชีต`)) return;
    setBusy(true);
    try { await fetch("/api/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "disconnect", channelId: c.channelId }) }); await refresh(); } finally { setBusy(false); }
  };

  return (
    <Card title="เชื่อมช่องทางแชท" subtitle="ใส่ Access Token + ตั้ง Webhook แล้วข้อความจะเข้าระบบอัตโนมัติ เพื่อคำนวณ SLA">
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-5">
          <div className="rounded-xl border border-brand-2 bg-brand-faint p-3 text-sm"><b>Facebook Messenger</b><div className="mt-1 text-xs text-muted">{fb.length ? `เชื่อมแล้ว ${fb.length} เพจ` : "ยังไม่ได้เชื่อม"}</div></div>
          <div className={`rounded-xl border p-3 text-sm ${instagram.length ? "border-pink-300 bg-pink-50" : "border-line"}`}><b className="inline-flex items-center gap-1"><Camera size={14} /> Instagram Messaging</b><div className="mt-1 text-xs text-muted">{instagram.length ? `เชื่อมแล้ว ${instagram.length} บัญชี` : "เชื่อมผ่านเพจ Facebook"}</div></div>
          <div className={`rounded-xl border p-3 text-sm ${ads.length ? "border-brand-2 bg-brand-faint" : "border-line"}`}><b>โฆษณา (Marketing API)</b><div className="mt-1 text-xs text-muted">{ads.length ? `เชื่อมแล้ว ${ads.length} บัญชี` : "ยังไม่ได้เชื่อม"}</div></div>
          <div className="rounded-xl border border-line p-3 text-sm text-muted"><b>LINE</b> <Badge>เร็วๆ นี้</Badge></div>
          <div className="rounded-xl border border-line p-3 text-sm text-muted"><b>WhatsApp</b> <Badge>เร็วๆ นี้</Badge></div>
        </div>

        {fb.map((c) => (
          <div key={c.channelId} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
            <Plug size={14} className="text-brand" /><b>{c.name || c.accountId}</b><span className="text-xs text-muted">Token …{c.tokenTail} · เก็บในเพจ {data.pages.find((p) => p.id === c.sheetPageId)?.name ?? c.sheetPageId}</span>
            {instagram.find((item) => item.channelId === `instagram:${c.accountId}`) && <span className="inline-flex items-center gap-1 text-xs text-pink-700"><Camera size={12} /> {instagram.find((item) => item.channelId === `instagram:${c.accountId}`)?.name}</span>}
            {!c.hasSecret && <Badge tone="red">ยังไม่มี App Secret</Badge>}
            <span className="ml-auto flex gap-2"><Btn size="sm" onClick={() => { setEditing(c.channelId); setFbDest(c.sheetPageId || ""); }}>แก้ไข</Btn><Btn size="sm" onClick={() => disconnect(c)} disabled={busy}>ยกเลิกการเชื่อม</Btn></span>
          </div>))}

        <div className="max-w-xl space-y-3 rounded-xl border border-brand-2 bg-brand-faint p-3">
          <h3 className="text-sm font-semibold">เชื่อมทุกเพจในครั้งเดียว</h3>
          <p className="text-xs text-muted">วางโทเคนผู้ใช้ครั้งเดียว ระบบจะเชื่อมทุกเพจที่โทเคนนั้นดูแล สมัครรับแชทอัตโนมัติ และจับคู่กับเพจในระบบตามชื่อ (ถ้ายังไม่มีจะสร้างให้) เพจที่เชื่อมไว้แล้วจะอัปเดตโทเคน</p>
          <label className="block text-xs font-medium text-muted">Access Token (ผู้ใช้)
            <input type="password" autoComplete="off" value={allToken} onChange={(event) => setAllToken(event.target.value)} placeholder="EAAB…" className={`${inp} mt-1`} /></label>
          <label className="block text-xs font-medium text-muted">App Secret ของ Meta App ที่ออกโทเคน (Meta App → Settings → Basic)
            <input type="password" autoComplete="off" value={allSecret} onChange={(event) => setAllSecret(event.target.value)} className={`${inp} mt-1`} /></label>
          {allMsg && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{allMsg}</p>}
          <Btn variant="primary" onClick={() => void connectAll()} disabled={allBusy || !allToken || !allSecret} aria-busy={allBusy}>{allBusy ? "กำลังเชื่อมทุกเพจ…" : "เชื่อมทุกเพจ"}</Btn>
          {allRes && <div className="space-y-1.5 text-sm" role="status">
            {allRes.results.map((page) => (
              <div key={page.fbPageId} className="rounded-lg bg-white px-3 py-2">
                <b>{page.ok ? "✓" : "✗"} {page.name || page.fbPageId}</b>
                {page.ok
                  ? <span className="text-xs text-muted"> · เก็บในเพจ {data.pages.find((item) => item.id === page.systemPageId)?.name ?? page.systemPageId}{page.createdPage ? " (สร้างใหม่)" : ""} · {page.subscribed ? "รับแชทอัตโนมัติแล้ว" : `สมัครรับแชทไม่สำเร็จ: ${page.subscribeMessage}`}</span>
                  : <span className="text-xs text-red-600"> · {page.message}</span>}
                {page.ok && page.instagram && <span className="block text-xs text-pink-700">พบ Instagram ที่ผูกกับเพจนี้: @{page.instagram.username || page.instagram.id} · เปิดใช้ Instagram → messages ใน Meta App Dashboard</span>}
                {page.ok && page.instagramLookupMessage && <span className="block text-xs text-amber-700">ค้นหา Instagram ไม่สำเร็จ (คงสถานะการเชื่อมเดิมไว้): {page.instagramLookupMessage}</span>}
              </div>))}
            {allRes.ads && <p className="text-xs text-muted">{adsText(allRes.ads)}</p>}
            {allRes.extend && <p className={allRes.extend.extended ? "text-xs text-muted" : "rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"}>{extendText(allRes.extend)}</p>}
          </div>}
        </div>

        <div className="max-w-xl space-y-3 rounded-xl bg-gray-50 p-3">
          <h3 className="text-sm font-semibold">ข้อมูล Webhook สำหรับใส่ใน Meta</h3>
          <CopyBox label="Callback URL" value={hook} />
          {(fb[0]?.verifyToken || verify)
            ? <CopyBox label="Verify Token" value={fb[0]?.verifyToken || verify} />
            : <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">ยังไม่มี Verify Token — ตั้งค่า <b>AUTH_SECRET</b> หรือ <b>FB_WEBHOOK_VERIFY_TOKEN</b> ใน Vercel (Environment Variables) แล้ว Redeploy</p>}
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
            <li>ใน Meta App เปิดผลิตภัณฑ์ Messenger/Instagram Messaging และ Webhooks; ตั้ง Callback URL กับ Verify Token นี้ใน Webhooks object ทั้ง <b>Page</b> และ <b>Instagram</b> แล้วกด <b>Verify and Save</b></li>
            <li>สำหรับ Facebook Page ให้เลือก Webhooks object <b>Page</b> และ subscribe <b>messages</b> กับ <b>message_echoes</b></li>
            <li>สำหรับ Instagram ให้เลือก <b>Instagram</b> ใน Messenger → Instagram settings/Webhooks และ subscribe ฟิลด์ <b>messages</b> (Instagram ส่ง echo ผ่านฟิลด์นี้ ไม่ต้อง subscribe message_echoes)</li>
            <li>กด “บันทึกและเชื่อมต่อ” เพื่อสมัคร Facebook Page กับแอป และค้นหา Instagram Professional ที่ผูก Page. Instagram webhook ไม่ได้สมัครผ่าน Page subscribed_apps: ใน Meta App Dashboard ให้เลือก webhook object <b>Instagram</b> แล้วเปิดฟิลด์ <b>messages</b>.</li>
            <li>ใช้ Page token ที่อนุญาต <b>instagram_basic</b>, <b>instagram_manage_messages</b>, <b>pages_manage_metadata</b> (และ <b>pages_show_list</b> เมื่อต่อด้วย User token); ผู้เชื่อมต้องมี Page task <b>MESSAGE</b> และผู้ใช้ Instagram ต้องเปิด <b>Allow Access to Messages</b> ใน Instagram → Messages and story replies → Message controls → Connected Tools</li>
            <li>Meta App ต้อง Published เพื่อรับ Webhooks; Standard Access ใช้ทดสอบเฉพาะคนที่มี role ใน App ส่วนลูกค้าจริงต้องขอ Advanced Access/App Review สำหรับสิทธิ์ที่ใช้</li>
          </ol>
          <p className="text-xs text-muted">Webhook ได้เฉพาะข้อความ “ตั้งแต่ตอนนี้เป็นต้นไป” — ของเก่าใช้ปุ่มดึงย้อนหลังด้านล่าง · ถ้าแอป Meta ยังเป็นโหมด Development จะได้รับเฉพาะข้อความจากคนที่มี role ในแอป (Admin/Developer/Tester)</p>
        </div>

        {form ? (
          <div className="max-w-xl space-y-3 rounded-xl border border-line p-3">
            <h3 className="text-sm font-semibold">{editing ? "แก้ไขการเชื่อมต่อ Facebook" : "เชื่อมเพจ Facebook"}</h3>
            <label className="block text-xs font-medium text-muted">Page Access Token{editing ? " (เว้นว่าง = ใช้ตัวเดิม)" : ""}
              <span className="block font-normal">วางโทเคนของเพจ หรือโทเคนผู้ใช้จาก Graph API Explorer ก็ได้ — ระบบจะแลกเป็นโทเคนของเพจให้เอง</span>
              <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAB…" className={`${inp} mt-1`} /></label>
            <label className="block text-xs font-medium text-muted">App Secret (Meta App → Settings → Basic){editing ? " (เว้นว่าง = ใช้ตัวเดิม)" : ""}
              <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} className={`${inp} mt-1`} /></label>
            <Select label="เก็บแชทเข้าเพจในระบบ" value={fbDest} onChange={setFbDest} options={[{ value: "", label: "อัตโนมัติ — ตามเพจ Facebook นี้" }, ...data.pages.filter((page) => page.active).map((page) => ({ value: page.id, label: page.name }))]} />
            <p className="text-xs text-muted">Instagram ที่ผูกกับเพจนี้จะถูกเก็บในเพจแยก “ชื่อเพจ (Instagram)” เพื่อกรองดูแชท IG แยกจาก Facebook</p>
            {choices.length > 0 && <Select label="เลือกเพจ Facebook ที่จะเชื่อม" value={fbPageId} onChange={setFbPageId} options={[{ value: "", label: "— เลือกเพจ —" }, ...choices.map((c) => ({ value: c.id, label: `${c.name} (${c.id})` }))]} />}
            {msg && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{msg}</p>}
            <div className="flex gap-2"><Btn variant="primary" onClick={save} disabled={busy || (!editing && !token) || (choices.length > 0 && !fbPageId)}>{busy ? "กำลังตรวจสอบ…" : "บันทึกและเชื่อมต่อ"}</Btn>{editing !== null && <Btn onClick={() => { setEditing(null); setMsg(""); }}>ยกเลิก</Btn>}</div>
            <p className="text-xs text-amber-700">⚠ Token และ App Secret จะถูกเก็บในแท็บ <b>channels</b> ของ Google Sheet — ใครก็ตามที่เปิดชีตได้จะเห็น ควรตั้งการแชร์ชีตเป็น “จำกัด” (Restricted) เฉพาะคนที่ไว้ใจ ระบบจะไม่ส่งค่าเหล่านี้กลับมาที่เบราว์เซอร์</p>
          </div>
        ) : <Btn size="sm" onClick={() => { setEditing(""); setFbDest(""); }}>+ เชื่อมเพจเพิ่ม</Btn>}


        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="text-sm font-semibold">โฆษณา — ดึงสถิติจาก Meta โดยตรง (ไม่ต้องอัปโหลดไฟล์)</h3>
          {ads.map((c) => (
            <div key={c.channelId} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
              <Plug size={14} className="text-brand" /><b>{c.name || c.accountId}</b><span className="text-xs text-muted">act_{c.accountId} · Token …{c.tokenTail} · {c.forceSheetPage ? "บังคับเก็บทั้งหมดใน" : "เพจสำรอง"} {data.pages.find((p) => p.id === c.sheetPageId)?.name ?? c.sheetPageId}</span>
              <span className="ml-auto flex gap-2">
                <Btn size="sm" onClick={() => { setAdAcct(c.accountId); setAdToken(""); setPageId(c.sheetPageId || selectedPageId); setAdForcePage(c.forceSheetPage); setEditingAdChannel(c.channelId); setAdEdit(true); setAdMsg(""); }} disabled={busy}>แก้ไข</Btn>
                <Btn size="sm" onClick={() => disconnect(c)} disabled={busy}>ยกเลิกการเชื่อม</Btn>
              </span>
            </div>))}
          {adForm ? (
            <div className="max-w-xl space-y-3 rounded-xl border border-line p-3">
              <h4 className="text-sm font-semibold">{editingAdChannel ? "แก้ไขบัญชีโฆษณา" : "เชื่อมบัญชีโฆษณา"}</h4>
              <label className="block text-xs font-medium text-muted">Access Token ที่มีสิทธิ์ ads_read{editingAdChannel ? " (เว้นว่าง = ใช้ตัวเดิม)" : ""}
                <input type="password" autoComplete="off" value={adToken} onChange={(e) => setAdToken(e.target.value)} placeholder="EAAB…" className={`${inp} mt-1`} /></label>
              <label className="block text-xs font-medium text-muted">Ad Account ID (ตัวเลขใน Ads Manager เช่น 1234567890)
                <input value={adAcct} onChange={(e) => setAdAcct(e.target.value)} disabled={busy || !!editingAdChannel} placeholder="act_1234567890" className={`${inp} mt-1`} /></label>
              {!editingAdChannel && <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Btn size="sm" onClick={() => void loadAdAccounts(adToken)} disabled={adListBusy || busy || (!adToken && !ads.length)} aria-busy={adListBusy}>
                    {adListBusy ? "กำลังดึงรายการ…" : adToken ? "ดึงรายการด้วยโทเคนนี้" : "ดึงรายการบัญชีที่เชื่อมไว้"}
                  </Btn>
                  <span className="text-xs text-muted">ดึงจาก Meta แล้วเลือกบัญชีได้เลย · ใช้ User/System User token (Page token ไม่เห็นบัญชีโฆษณา)</span>
                </div>
                {adListMsg && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{adListMsg}</p>}
                {adList && adList.length > 0 && <Select label={`บัญชีโฆษณาที่โทเคนมองเห็น (${adList.length})`} value={adAcct} onChange={setAdAcct}
                  options={[{ value: "", label: "— เลือกบัญชี —" }, ...adList.map((a) => ({ value: a.id, label: `${a.name || "ไม่มีชื่อ"} · act_${a.id}${a.currency ? ` · ${a.currency}` : ""}${a.connected ? " · เชื่อมแล้ว" : ""}` }))]} />}
              </div>}
              <Select label="เพจในระบบปลายทาง (ค่าเริ่มต้นของบัญชีนี้)" value={selectedPageId} onChange={setPageId} options={data.pages.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} />
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line p-3 text-sm">
                <input type="checkbox" checked={adForcePage} onChange={(e) => setAdForcePage(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
                <span>บังคับใช้เพจที่เลือกกับโฆษณาทั้งหมดในบัญชีนี้</span>
              </label>
              <p className="text-xs text-muted">ถ้าไม่เลือก ระบบใช้ mapping ของเพจ Facebook ต้นทางก่อน และใช้เพจนี้เป็นค่าเริ่มต้นเมื่อไม่พบ mapping</p>
              {editingAdChannel && <p className="text-xs text-muted">ถ้าโทเคนหมดอายุ ให้วางโทเคนใหม่ที่มีสิทธิ์ ads_read; ถ้าต้องการเปลี่ยนเฉพาะเพจปลายทาง ให้เว้นช่องโทเคนว่าง</p>}
              {adMsg && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{adMsg}</p>}
              <div className="flex gap-2"><Btn variant="primary" onClick={saveAds} disabled={busy || !adAcct || (!adToken && !editingAdChannel)}>{busy ? "กำลังตรวจสอบ…" : editingAdChannel ? "บันทึกการแก้ไข" : "บันทึกและเชื่อมต่อ"}</Btn>{ads.length > 0 && <Btn onClick={() => { setAdEdit(false); setEditingAdChannel(null); setAdAcct(""); setAdToken(""); setAdMsg(""); }}>ยกเลิก</Btn>}</div>
              <p className="text-xs text-amber-700">⚠ Token เก็บในแท็บ <b>channels</b> ของ Google Sheet เหมือนช่องทางแชท · คุณต้องเป็นผู้ดูแลบัญชีโฆษณานี้ · ปุ่มดึงข้อมูลอยู่ด้านล่าง การอัปโหลดไฟล์ด้านล่างสุดเก็บไว้เป็นทางสำรอง</p>
            </div>
          ) : <Btn size="sm" onClick={() => { setAdAcct(""); setAdToken(""); setAdForcePage(false); setEditingAdChannel(null); setAdMsg(""); setAdList(null); setAdListMsg(""); setAdEdit(true); void loadAdAccounts(""); }}>+ เชื่อมบัญชีโฆษณาเพิ่ม</Btn>}
        </div>
      </div>
    </Card>
  );
}
