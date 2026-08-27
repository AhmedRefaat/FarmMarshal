/**
 * security/uploads.ts — upload content validation.
 *
 * Addresses: SEC-H6 (no size cap, no MIME allow-list, and the stored file
 * extension was derived from the client-supplied MIME type, which let a caller
 * choose the extension of a file written into a statically served directory).
 *
 * Two independent checks are required because a declared MIME type is caller
 * input: the declared type must be on the allow-list AND the leading bytes must
 * match that type's signature.
 */

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024);

/** Declared MIME type → canonical stored extension. The extension never comes from the client. */
export const ALLOWED_UPLOAD_TYPES: Readonly<Record<string, string>> = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
});

type Signature = { offset: number; bytes: number[] };

/** Magic-byte signatures. A type with several container variants lists each. */
const SIGNATURES: Readonly<Record<string, Signature[]>> = Object.freeze({
  'image/jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  // RIFF....WEBP — the 4 size bytes at offset 4 are skipped by the two-part check.
  'image/webp': [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
  // Matroska/WebM EBML header.
  'audio/webm': [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }],
  'video/webm': [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }],
  // ID3-tagged or bare MPEG frame sync.
  'audio/mpeg': [{ offset: 0, bytes: [0x49, 0x44, 0x33] }, { offset: 0, bytes: [0xff, 0xfb] }],
  'audio/mp4': [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
  'application/pdf': [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }],
});

export type UploadCheck =
  | { ok: true; extension: string }
  | { ok: false; status: 400 | 413 | 415; error: string };

function matches(buffer: Buffer, signature: Signature): boolean {
  if (buffer.length < signature.offset + signature.bytes.length) return false;
  return signature.bytes.every((b, i) => buffer[signature.offset + i] === b);
}

/** True when the buffer's leading bytes are consistent with the declared type. */
export function signatureMatches(mimeType: string, buffer: Buffer): boolean {
  const variants = SIGNATURES[mimeType];
  if (!variants) return false;
  // 'audio/mpeg' lists alternative headers; any one matching is sufficient.
  if (mimeType === 'audio/mpeg') return variants.some((v) => matches(buffer, v));
  // Multi-part signatures (WebP) must all match.
  return variants.every((v) => matches(buffer, v));
}

/**
 * Validate a completed upload and return the extension the server will use.
 * The caller-supplied filename is never used to derive the stored name.
 */
export function validateUpload(
  declaredMimeType: string | undefined,
  buffer: Buffer,
  maxBytes = MAX_UPLOAD_BYTES,
): UploadCheck {
  if (!buffer || buffer.length === 0) {
    return { ok: false, status: 400, error: 'uploaded file is empty' };
  }
  if (buffer.length > maxBytes) {
    return { ok: false, status: 413, error: `file exceeds the ${maxBytes} byte limit` };
  }
  const mime = (declaredMimeType ?? '').split(';')[0].trim().toLowerCase();
  const extension = ALLOWED_UPLOAD_TYPES[mime];
  if (!extension) {
    return { ok: false, status: 415, error: 'unsupported media type' };
  }
  if (!signatureMatches(mime, buffer)) {
    return { ok: false, status: 415, error: 'file content does not match its declared type' };
  }
  return { ok: true, extension };
}

/**
 * Reduce a caller-supplied filename to a safe label for logging or metadata.
 * Strips directory separators, traversal sequences, and control characters.
 */
export function sanitizeFilename(name: unknown): string {
  if (typeof name !== 'string' || name.length === 0) return 'upload';
  const base = name.replace(/[\\/]/g, '_').replace(/\.\.+/g, '_');
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  return cleaned.slice(0, 100) || 'upload';
}
