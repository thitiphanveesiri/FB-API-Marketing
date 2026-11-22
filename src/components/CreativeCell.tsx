"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Btn, HoverPreview, Modal, TextInput, AdThumb, imageSrc } from "@/components/ui";
import { askForFreshLink, useCreativeUrl } from "@/lib/creativeClient";
import { linkLooksExpired } from "@/lib/creativeUrl";
import AdPreview from "@/components/AdPreview";
import { useStore } from "@/lib/store";
import { roleCan } from "@/lib/queries";
import { isVideoFileUrl, resolveCreativeMedia } from "@/lib/creativeMedia";
import type { Ad } from "@/lib/types";

const youtubeId = (u: string) => u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/)?.[1];
const isFacebook = (u: string) => /^https:\/\/(?:www\.|web\.)?facebook\.com\//i.test(u);

/** Ad thumbnail that opens a viewer for the real image/video; people who can upload data can paste the links. */
export default function CreativeCell({ ad, size = 40, preview }: { ad: Ad; size?: number; preview?: ReactNode }) {
  const { user, setCreative, toast } = useStore();
  const [open, setOpen] = useState(false);
  const [img, setImg] = useState(""); const [vid, setVid] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const canEdit = roleCan.upload(user.role);
  const media = resolveCreativeMedia(ad.creative);
  const show = () => { setImg(media.imageUrl ?? ""); setVid(media.videoUrl ?? ""); setErr(""); setOpen(true); };
  const save = async () => {
    const bad = [img, vid].find((v) => v.trim() && !/^https:\/\//i.test(v.trim()));
    if (bad) { setErr("ลิงก์ต้องขึ้นต้นด้วย https://"); return; }
    setBusy(true); const ok = await setCreative(ad.id, img, vid); setBusy(false);
    if (ok) { toast("บันทึกครีเอทีฟแล้ว"); setOpen(false); }
  };
  // The stored Meta link ages out; show the refreshed one when this page has it, and ask for a new one when it is already past.
  // Some imported rows put an .mp4 link in creative_url. Never pass that URL to <img>;
  // treat it as video unless a dedicated video_url is already present.
  const v = media.videoUrl;
  const yt = v ? youtubeId(v) : undefined;
  const refreshed = useCreativeUrl(ad.id, ad.creative.url);
  // A video filed as the picture has no usable image of its own, but a refreshed cover (a real picture) is welcome.
  const live = media.imageUrl ? refreshed : (refreshed && !isVideoFileUrl(refreshed) ? refreshed : undefined);
  const src = imageSrc(live);
  useEffect(() => { if (media.imageUrl ? linkLooksExpired(live) : !live) askForFreshLink(ad.id); }, [ad.id, live, media.imageUrl]);
  return (
    <>
      <HoverPreview content={preview ?? <AdPreview ad={ad} />}>
        <button type="button" onClick={(e) => { e.stopPropagation(); show(); }} aria-label={`ดูครีเอทีฟ ${ad.name}`} className="rounded-lg outline-none ring-brand-2 hover:opacity-90 focus-visible:ring-2">
          <AdThumb hue={ad.creative.hue} type={ad.creative.type} size={size} src={live} adId={ad.id} hasVideo={!!v} />
        </button>
      </HoverPreview>
      <Modal open={open} onClose={() => setOpen(false)} title={ad.name} width={640}
        footer={canEdit ? <><Btn onClick={() => setOpen(false)}>ยกเลิก</Btn><Btn variant="primary" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึก"}</Btn></> : <Btn onClick={() => setOpen(false)}>ปิด</Btn>}>
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- pasted link */}
          {src && <img src={src} alt={ad.name} referrerPolicy="no-referrer" onError={() => askForFreshLink(ad.id)} className="max-h-[360px] w-full rounded-lg bg-gray-50 object-contain" />}
          {v && (yt ? <iframe className="aspect-video w-full rounded-lg" src={`https://www.youtube-nocookie.com/embed/${yt}`} title={ad.name} allowFullScreen />
            : isVideoFileUrl(v) ? <video src={v} controls className="max-h-[360px] w-full rounded-lg bg-black" />
            : isFacebook(v) ? <div className="space-y-1.5">
              <iframe className="aspect-video w-full rounded-lg bg-black" src={`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(v)}&show_text=false`}
                title={`วิดีโอโฆษณา ${ad.name}`} allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowFullScreen />
              <a href={v} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-brand-2 hover:underline">วิดีโอไม่เล่น? เปิดใน Facebook (แท็บใหม่)</a>
            </div>
            : <a href={v} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-brand-2 hover:bg-gray-50">▶ เปิดวิดีโอโฆษณา (แท็บใหม่)</a>)}
          {!src && !v && <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-muted">ยังไม่มีรูปหรือวิดีโอของโฆษณานี้{canEdit ? " — วางลิงก์ด้านล่างได้เลย" : ""}</p>}
          {(ad.headline || ad.caption) && <div className="space-y-1">
            {ad.headline && <p className="text-sm font-semibold">{ad.headline}</p>}
            {ad.caption && <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{ad.caption}</p>}
          </div>}
          {canEdit && <div className="space-y-2">
            <TextInput label="ลิงก์รูปโฆษณา (https://)" value={img} onChange={(e) => setImg(e.target.value)} />
            <TextInput label="ลิงก์วิดีโอ (.mp4, YouTube หรือลิงก์ Facebook)" value={vid} onChange={(e) => setVid(e.target.value)} error={err} />
            <p className="text-xs text-muted">ระบบดึงรูปและวิดีโอจากโฆษณาให้ตอน “ซิงก์โฆษณา” (ถ้าโฆษณาไม่มีรูปในตัว creative จะไปเอารูปจากโพสต์จริง) · วางลิงก์เองทับได้ เช่น Google Drive: แชร์เป็น “ทุกคนที่มีลิงก์” แล้วคัดลอกลิงก์มาวาง</p>
          </div>}
        </div>
      </Modal>
    </>
  );
}
