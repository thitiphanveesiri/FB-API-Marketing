"use client";
import { useState } from "react";
import { Btn, Modal, TextInput, AdThumb, imageSrc } from "@/components/ui";
import { useStore } from "@/lib/store";
import { roleCan } from "@/lib/queries";
import type { Ad } from "@/lib/types";

const youtubeId = (u: string) => u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/)?.[1];
const isFile = (u: string) => /\.(mp4|webm|mov)(\?|#|$)/i.test(u);

/** Ad thumbnail that opens a viewer for the real image/video; people who can upload data can paste the links. */
export default function CreativeCell({ ad, size = 40 }: { ad: Ad; size?: number }) {
  const { user, setCreative, toast } = useStore();
  const [open, setOpen] = useState(false);
  const [img, setImg] = useState(""); const [vid, setVid] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const canEdit = roleCan.upload(user.role);
  const show = () => { setImg(ad.creative.url ?? ""); setVid(ad.creative.video ?? ""); setErr(""); setOpen(true); };
  const save = async () => {
    const bad = [img, vid].find((v) => v.trim() && !/^https:\/\//i.test(v.trim()));
    if (bad) { setErr("ลิงก์ต้องขึ้นต้นด้วย https://"); return; }
    setBusy(true); const ok = await setCreative(ad.id, img, vid); setBusy(false);
    if (ok) { toast("บันทึกครีเอทีฟแล้ว"); setOpen(false); }
  };
  const v = ad.creative.video; const yt = v ? youtubeId(v) : undefined; const src = imageSrc(ad.creative.url);
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); show(); }} aria-label={`ดูครีเอทีฟ ${ad.name}`} className="rounded-lg outline-none ring-brand-2 hover:opacity-90 focus-visible:ring-2">
        <AdThumb hue={ad.creative.hue} type={ad.creative.type} size={size} src={ad.creative.url} hasVideo={!!v} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={ad.name} width={640}
        footer={canEdit ? <><Btn onClick={() => setOpen(false)}>ยกเลิก</Btn><Btn variant="primary" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึก"}</Btn></> : <Btn onClick={() => setOpen(false)}>ปิด</Btn>}>
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- pasted link */}
          {src && <img src={src} alt={ad.name} referrerPolicy="no-referrer" className="max-h-[360px] w-full rounded-lg bg-gray-50 object-contain" />}
          {v && (yt ? <iframe className="aspect-video w-full rounded-lg" src={`https://www.youtube-nocookie.com/embed/${yt}`} title={ad.name} allowFullScreen />
            : isFile(v) ? <video src={v} controls className="max-h-[360px] w-full rounded-lg bg-black" />
            : <a href={v} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-brand-2 hover:bg-gray-50">▶ เปิดวิดีโอโฆษณา (แท็บใหม่)</a>)}
          {!src && !v && <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-muted">ยังไม่มีรูปหรือวิดีโอของโฆษณานี้{canEdit ? " — วางลิงก์ด้านล่างได้เลย" : ""}</p>}
          {canEdit && <div className="space-y-2">
            <TextInput label="ลิงก์รูปโฆษณา (https://)" value={img} onChange={(e) => setImg(e.target.value)} />
            <TextInput label="ลิงก์วิดีโอ (.mp4, YouTube หรือลิงก์ Facebook)" value={vid} onChange={(e) => setVid(e.target.value)} error={err} />
            <p className="text-xs text-muted">Meta ไม่ให้ไฟล์ภาพในรายงานที่ดาวน์โหลด จึงต้องวางลิงก์เอง · ใช้ Google Drive ได้: อัปโหลดไฟล์ → แชร์เป็น “ทุกคนที่มีลิงก์” → คัดลอกลิงก์มาวาง</p>
          </div>}
        </div>
      </Modal>
    </>
  );
}
