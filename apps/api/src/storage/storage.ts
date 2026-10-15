import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** A short-lived URL the browser PUTs the file's bytes to. */
export type UploadTicket = {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
};

export type DownloadOptions = {
  filename: string;
  contentType: string;
  /** Shown in the browser (images, PDFs) instead of downloaded. */
  inline: boolean;
};

/** Where file bytes live. Metadata is always in Postgres (FileObject). */
export interface StorageDriver {
  readonly kind: 'r2' | 'local';
  /**
   * A URL to PUT exactly `size` bytes to `key` (an upload key, never the
   * key a file is served from).
   */
  uploadUrl(key: string, contentType: string, size: number): Promise<UploadTicket>;
  /** Moves the object from `from` to `to` (the upload key to the final key). */
  move(from: string, to: string): Promise<void>;
  /** The stored size, or null when nothing was uploaded under `key`. */
  size(key: string): Promise<number | null>;
  /** The first `bytes` bytes, to check the file signature. */
  readStart(key: string, bytes: number): Promise<Buffer>;
  remove(key: string): Promise<void>;
  downloadUrl(key: string, options: DownloadOptions): Promise<string>;
}

export const UPLOAD_TTL_SECONDS = 10 * 60;
export const DOWNLOAD_TTL_SECONDS = 15 * 60;

/** Only keys we generate ever reach the drivers; this keeps a bad one out of the filesystem. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9/_-]*$/;
export function assertKey(key: string) {
  if (!KEY_PATTERN.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

/** `attachment; filename=...` with a safe ASCII fallback and the UTF-8 name. */
export function contentDisposition(filename: string, inline: boolean) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Cloudflare R2 (S3-compatible). The bucket stays private: every read and
// write goes through a URL signed for a few minutes.
export class R2Driver implements StorageDriver {
  readonly kind = 'r2' as const;
  private readonly client: S3Client;

  constructor(
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
    private readonly bucket: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async uploadUrl(key: string, contentType: string, size: number): Promise<UploadTicket> {
    assertKey(key);
    // Content-Length is part of the signature, so the PUT must carry exactly
    // the size that was approved (the browser sets it from the file).
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      {
        expiresIn: UPLOAD_TTL_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async size(key: string) {
    assertKey(key);
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return head.ContentLength ?? null;
    } catch (err) {
      if ((err as { name?: string }).name === 'NotFound') return null;
      throw err;
    }
  }

  async readStart(key: string, bytes: number) {
    assertKey(key);
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=0-${bytes - 1}`,
      }),
    );
    return Buffer.from((await res.Body?.transformToByteArray()) ?? []);
  }

  async remove(key: string) {
    assertKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async move(from: string, to: string) {
    assertKey(from);
    assertKey(to);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: to,
        CopySource: `${this.bucket}/${from}`,
      }),
    );
    await this.remove(from);
  }

  downloadUrl(key: string, options: DownloadOptions) {
    assertKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: options.contentType,
        ResponseContentDisposition: contentDisposition(
          options.filename,
          options.inline,
        ),
      }),
      { expiresIn: DOWNLOAD_TTL_SECONDS },
    );
  }
}

type LocalToken = {
  op: 'put' | 'get';
  key: string;
  exp: number; // epoch seconds
  ct: string;
  max?: number;
  fn?: string;
  inline?: boolean;
};

// Development only: files go to a folder next to the API, and the "signed
// URLs" point at the API itself (/api/files/local/<token>), signed with a key
// that changes on every restart.
export class LocalDriver implements StorageDriver {
  readonly kind = 'local' as const;
  private readonly secret = randomBytes(32);

  constructor(readonly root: string) {}

  path(key: string) {
    assertKey(key);
    const full = resolve(this.root, ...key.split('/'));
    if (!full.startsWith(resolve(this.root) + sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return full;
  }

  sign(token: LocalToken) {
    const body = Buffer.from(JSON.stringify(token)).toString('base64url');
    const sig = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  /** The token's contents if its signature is ours and it hasn't expired. */
  verify(token: string, op: LocalToken['op']): LocalToken | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', this.secret).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return null;
    try {
      const parsed = JSON.parse(
        Buffer.from(body, 'base64url').toString(),
      ) as LocalToken;
      if (parsed.op !== op || parsed.exp < Date.now() / 1000) return null;
      assertKey(parsed.key);
      return parsed;
    } catch {
      return null;
    }
  }

  uploadUrl(
    key: string,
    contentType: string,
    size: number,
  ): Promise<UploadTicket> {
    const exp = Math.floor(Date.now() / 1000) + UPLOAD_TTL_SECONDS;
    const token = this.sign({
      op: 'put',
      key,
      exp,
      ct: contentType,
      max: size,
    });
    return Promise.resolve({
      url: `/api/files/local/${token}`,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(exp * 1000).toISOString(),
    });
  }

  async size(key: string) {
    try {
      return (await stat(this.path(key))).size;
    } catch {
      return null;
    }
  }

  async readStart(key: string, bytes: number) {
    const handle = await open(this.path(key), 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }

  async move(from: string, to: string) {
    await rename(this.path(from), await this.prepare(to));
  }

  downloadUrl(key: string, options: DownloadOptions) {
    const token = this.sign({
      op: 'get',
      key,
      exp: Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS,
      ct: options.contentType,
      fn: options.filename,
      inline: options.inline,
    });
    return Promise.resolve(`/api/files/local/${token}`);
  }

  async prepare(key: string) {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    return full;
  }

  open(key: string) {
    return createReadStream(this.path(key));
  }
}

export const localStorageRoot = () => join(process.cwd(), '.storage');
