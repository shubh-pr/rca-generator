import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config.js';

/**
 * File storage for attachments. Only the object key is stored in the database; keys are random
 * and never derived from user input. Local disk is for development; production uses any
 * S3-compatible store (AWS S3, Cloudflare R2, Backblaze B2, MinIO).
 */
export interface Storage {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  /** Readiness probe. */
  check(): Promise<void>;
}

/** Keys look like ws/<uuid>/rca/<uuid>/<uuid>.<ext>; anything else is rejected. */
const KEY_RE = /^(ws\/[0-9a-f-]{36}\/rca\/[0-9a-f-]{36}\/)?[0-9a-f-]{36}\.[a-z0-9]{1,5}$/;

export function assertKey(key: string) {
  if (!KEY_RE.test(key)) throw new Error('Invalid storage key');
}

export class LocalStorage implements Storage {
  readonly driver = 'local' as const;
  constructor(private root: string) {}
  private full(key: string) {
    assertKey(key);
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.full(key);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, body, { mode: 0o600 });
  }
  async get(key: string) {
    const p = this.full(key);
    await fs.promises.access(p);
    return fs.createReadStream(p);
  }
  async delete(key: string) {
    await fs.promises.rm(this.full(key), { force: true });
  }
  async check() {
    await fs.promises.mkdir(this.root, { recursive: true });
    await fs.promises.access(this.root, fs.constants.W_OK);
  }
}

export class S3Storage implements Storage {
  readonly driver = 's3' as const;
  private client: S3Client;
  constructor(private bucket: string, opts: { region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean }) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    assertKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentDisposition: 'attachment' }));
  }
  async get(key: string) {
    assertKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }
  async delete(key: string) {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async check() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

export function createStorage(): Storage {
  if (config.storage.driver === 's3') {
    const s = config.storage.s3;
    return new S3Storage(s.bucket!, { region: s.region, endpoint: s.endpoint, accessKeyId: s.accessKeyId!, secretAccessKey: s.secretAccessKey!, forcePathStyle: s.forcePathStyle });
  }
  return new LocalStorage(config.uploadDir);
}

let instance: Storage | undefined;
export function storage(): Storage {
  instance ??= createStorage();
  return instance;
}
export function setStorage(s: Storage) {
  instance = s;
}
