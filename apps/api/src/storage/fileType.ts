/**
 * Allowed attachment types (SPEC 8). The served Content-Type comes from this table, never from the
 * client, and the file content must match the extension (magic bytes / text check).
 */
export const ALLOWED_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
};

const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];

function isText(buf: Buffer) {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, 64 * 1024));
    return true;
  } catch {
    // A multi-byte character may be cut at the 64 KiB boundary; accept if the rest decodes.
    return buf.length > 64 * 1024;
  }
}

/** True when the bytes look like the claimed extension. */
export function contentMatches(ext: string, buf: Buffer): boolean {
  switch (ext) {
    case '.pdf':
      return startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case '.png':
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case '.jpg':
    case '.jpeg':
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case '.zip':
      return startsWith(buf, ZIP) || startsWith(buf, ZIP_EMPTY);
    case '.docx':
    case '.xlsx':
      return startsWith(buf, ZIP);
    case '.txt':
    case '.log':
    case '.csv':
      return isText(buf);
    default:
      return false;
  }
}
