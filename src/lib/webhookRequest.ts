export const WEBHOOK_BODY_LIMIT_BYTES = 1_000_000;

export type BoundedTextResult = { ok: true; text: string } | { ok: false; status: 413 };

/** Reject a declared oversized body before reading, and enforce the same byte limit when the header is absent or false. */
export async function readBoundedText(req: Request, limit = WEBHOOK_BODY_LIMIT_BYTES): Promise<BoundedTextResult> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit) return { ok: false, status: 413 };
  if (!req.body) return { ok: true, text: "" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
    return { ok: true, text: new TextDecoder().decode(Buffer.concat(chunks)) };
  } finally {
    reader.releaseLock();
  }
}
