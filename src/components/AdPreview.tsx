"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, imageSrc } from "@/components/ui";
import { askForFreshLink, useCreativeUrl } from "@/lib/creativeClient";
import { linkLooksExpired } from "@/lib/creativeUrl";
import { isVideoFileUrl, resolveCreativeMedia } from "@/lib/creativeMedia";
import type { Ad } from "@/lib/types";

/** Card shown when hovering an ad: its creative, the copy Meta returned, and the metrics the page passes in. */
export default function AdPreview({ ad, summary }: { ad: Ad; summary?: ReactNode }) {
  // A saved Meta link stops answering after a few days: use the one this page re-fetched, and ask when it has aged out.
  const media = resolveCreativeMedia(ad.creative);
  const videoFile = isVideoFileUrl(ad.creative.video) ? ad.creative.video : (media.videoInImageField ? ad.creative.url : undefined);
  const refreshed = useCreativeUrl(ad.id, ad.creative.url);
  const live = media.imageUrl ? refreshed : undefined;
  const [failed, setFailed] = useState<string | undefined>();
  useEffect(() => { if (media.imageUrl && linkLooksExpired(live)) askForFreshLink(ad.id); }, [ad.id, live, media.imageUrl]);
  const src = live === failed ? undefined : imageSrc(live);
  const tone = ad.status === "Active" ? "green" : ad.status === "Paused" ? "amber" : "gray";
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
      <div className="relative aspect-video w-full overflow-hidden"
        style={{ background: `linear-gradient(135deg, hsl(${ad.creative.hue} 55% 78%), hsl(${(ad.creative.hue + 40) % 360} 50% 62%))` }}>
        {videoFile
          ? <video src={videoFile} controls playsInline preload="metadata" className="h-full w-full bg-black object-contain" />
          : src
          // eslint-disable-next-line @next/next/no-img-element -- links are pasted by the user and can point anywhere
          ? <img src={src} alt={ad.name} referrerPolicy="no-referrer" onError={() => { setFailed(live); askForFreshLink(ad.id); }} className="h-full w-full object-cover" />
          : <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700/80">{ad.creative.type === "Video" ? "▶ วิดีโอ — ยังไม่มีภาพ" : "ยังไม่มีรูปครีเอทีฟ"}</span>}
        {(ad.creative.video || media.videoInImageField) && <span className="absolute left-2 top-2 rounded bg-gray-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">▶ วิดีโอ</span>}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-snug text-ink">{ad.name}</p>
          <Badge tone={tone}>{ad.status}</Badge>
        </div>
        {ad.headline && <p className="truncate text-xs font-medium text-ink">{ad.headline}</p>}
        {ad.caption
          ? <p className="line-clamp-6 whitespace-pre-line text-xs leading-relaxed text-muted">{ad.caption}</p>
          : <p className="text-xs text-muted">ยังไม่มีแคปชั่น — ดึงโฆษณาจาก Meta ใหม่เพื่อรับข้อความโฆษณา</p>}
        {summary}
        <p className="text-[10px] text-muted">คลิกที่รูปเพื่อดูรูปเต็ม · คลิกแถวเพื่อดูรายละเอียด</p>
      </div>
    </div>
  );
}
