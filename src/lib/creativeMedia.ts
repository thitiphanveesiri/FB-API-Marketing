export interface CreativeMediaInput {
  url?: string;
  video?: string;
}

export interface ResolvedCreativeMedia {
  /** Image URL safe to pass to an image renderer. */
  imageUrl?: string;
  /** Dedicated video URL, or an MP4 accidentally stored in the image field. */
  videoUrl?: string;
  /** True when the source Page/Ads row put a video file in the image field. */
  videoInImageField: boolean;
}

export const isVideoFileUrl = (url?: string): boolean =>
  !!url && /\.(mp4|webm|mov)(\?|#|$)/i.test(url);

/** Normalize creative fields for display without ever treating a video file as an image. */
export function resolveCreativeMedia(creative: CreativeMediaInput): ResolvedCreativeMedia {
  const videoInImageField = isVideoFileUrl(creative.url);
  return {
    imageUrl: videoInImageField ? undefined : creative.url,
    videoUrl: creative.video || (videoInImageField ? creative.url : undefined),
    videoInImageField,
  };
}
