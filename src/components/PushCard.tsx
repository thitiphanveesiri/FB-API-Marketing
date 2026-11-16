"use client";
import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Btn, Card } from "@/components/ui";
import { useStore } from "@/lib/store";

const b64 = (s: string) => { const p = "=".repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };

/** Turn alerts on / off for THIS phone or browser. Needs the service worker (public/sw.js). */
export default function PushCard() {
  const { toast } = useStore();
  const [state, setState] = useState<"loading" | "unsupported" | "unconfigured" | "off" | "on" | "blocked">("loading");
  const [busy, setBusy] = useState(false); const [key, setKey] = useState("");
  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

  useEffect(() => {
    let live = true;
    (async () => {
      if (ios && !standalone) { if (live) setState("unsupported"); return; }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { if (live) setState("unsupported"); return; }
      const j = await fetch("/api/push/subscribe", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (!live) return; if (!j?.ok || !j.configured) { setState("unconfigured"); return; }
      setKey(j.publicKey);
      if (Notification.permission === "denied") { setState("blocked"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js").catch(() => null);
      const sub = await reg?.pushManager.getSubscription();
      if (live) setState(sub ? "on" : "off");
    })();
    return () => { live = false; };
  }, [ios, standalone]);

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); toast("ยังไม่ได้อนุญาตการแจ้งเตือน", "info"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
      const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      const j = await r.json().catch(() => ({ ok: false }));
      if (!j.ok) { await sub.unsubscribe().catch(() => {}); toast(j.message || "เปิดแจ้งเตือนไม่สำเร็จ", "error"); return; }
      setState("on"); toast("เปิดแจ้งเตือนบนเครื่องนี้แล้ว", "success");
    } catch { toast("เปิดแจ้งเตือนไม่สำเร็จ", "error"); } finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/"); const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const response = await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        const result = await response.json().catch(() => ({ ok: false }));
        if (!response.ok || !result.ok) { toast(result.message || "ปิดแจ้งเตือนไม่สำเร็จ", "error"); return; }
        await sub.unsubscribe();
      }
      setState("off"); toast("ปิดแจ้งเตือนบนเครื่องนี้แล้ว", "info");
    } catch { toast("ปิดแจ้งเตือนไม่สำเร็จ", "error"); }
    finally { setBusy(false); }
  };
  const test = async () => { setBusy(true); const j = await fetch("/api/push/test", { method: "POST" }).then((r) => r.json()).catch(() => ({ ok: false })); setBusy(false); toast(j.ok ? "ส่งการแจ้งเตือนทดสอบแล้ว" : j.message || "ส่งไม่สำเร็จ", j.ok ? "success" : "error"); };

  return (
    <Card title="แจ้งเตือนบนมือถือ" subtitle="แจ้งข้อความใหม่ให้ Sales ที่ได้รับมอบหมาย · เตือนก่อนเกิน 15 นาที · แจ้งแชทค้าง" right={<BellRing size={16} className="text-brand-2" />}>
      <div className="space-y-2 text-sm">
        {state === "loading" && <p className="text-muted">กำลังตรวจสอบ…</p>}
        {state === "unsupported" && <p className="text-muted">{ios && !standalone ? "iPhone: กดปุ่มแชร์ใน Safari → “เพิ่มไปยังหน้าจอโฮม” แล้วเปิดแอปจากไอคอนนั้น จึงจะเปิดแจ้งเตือนได้ (iOS 16.4 ขึ้นไป)" : "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน ลองใช้ Chrome บน Android"}</p>}
        {state === "unconfigured" && <p className="text-muted">ผู้ดูแลระบบยังไม่ได้ตั้งค่าการแจ้งเตือนบนเซิร์ฟเวอร์ (ดูวิธีใน docs/NOTIFICATIONS.md)</p>}
        {state === "blocked" && <p className="text-amber-700">เครื่องนี้ปิดกั้นการแจ้งเตือนไว้ — เปิดอนุญาตที่การตั้งค่าเว็บไซต์ของเบราว์เซอร์ แล้วโหลดหน้านี้ใหม่</p>}
        {state === "off" && <Btn variant="primary" onClick={enable} disabled={busy}>เปิดแจ้งเตือนบนเครื่องนี้</Btn>}
        {state === "on" && <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-brand-faint px-2.5 py-0.5 text-xs font-medium text-brand">เปิดอยู่บนเครื่องนี้</span><Btn onClick={test} disabled={busy}>ส่งทดสอบ</Btn><Btn onClick={disable} disabled={busy}>ปิด</Btn></div>}
        <p className="text-xs text-muted">ข้อความใหม่จะส่งเฉพาะ Sales ที่ถูก assign; ถ้ายังไม่มีผู้ดูแลจะไม่ส่ง · ไม่ส่งข้อความใหม่ช่วง 22:00–08:00 · หัวหน้าและแอดมินได้รับแจ้งแชทค้างตามรอบระบบ</p>
      </div>
    </Card>
  );
}
