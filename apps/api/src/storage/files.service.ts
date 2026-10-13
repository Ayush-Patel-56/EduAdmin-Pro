import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FilePurpose } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DOWNLOAD_TTL_SECONDS,
  LocalDriver,
  R2Driver,
  localStorageRoot,
  type StorageDriver,
} from './storage.js';

const MB = 1024 * 1024;
const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];

/** File signatures ("magic bytes"): the start of a real file of each type. */
const SIGNATURES: Record<string, (head: Buffer) => boolean> = {
  'image/jpeg': (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
  'image/png': (h) =>
    h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (h) =>
    h.subarray(0, 4).toString('latin1') === 'RIFF' &&
    h.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (h) => h.subarray(0, 5).toString('latin1') === '%PDF-',
  // A .docx is a zip archive.
  [DOCX]: (h) => isZip(h),
  'application/zip': (h) => isZip(h),
  'video/mp4': (h) => h.subarray(4, 8).toString('latin1') === 'ftyp',
};

function isZip(h: Buffer) {
  return (
    h[0] === 0x50 &&
    h[1] === 0x4b &&
    ((h[2] === 0x03 && h[3] === 0x04) || (h[2] === 0x05 && h[3] === 0x06))
  );
}

type PurposeRule = {
  maxBytes: number;
  types: string[];
  /** For messages: "a JPG, PNG or WebP image". */
  describe: string;
};

/** What each kind of upload may be. Checked when the upload is requested and again on completion. */
export const PURPOSES: Record<FilePurpose, PurposeRule> = {
  STUDENT_PHOTO: {
    maxBytes: 2 * MB,
    types: IMAGES,
    describe: 'a JPG, PNG or WebP image',
  },
  FACULTY_PHOTO: {
    maxBytes: 2 * MB,
    types: IMAGES,
    describe: 'a JPG, PNG or WebP image',
  },
  // PRD 5.9: PDF, DOCX, ZIP, MP4; max 50 MB.
  STUDY_MATERIAL: {
    maxBytes: 50 * MB,
    types: ['application/pdf', DOCX, 'application/zip', 'video/mp4'],
    describe: 'a PDF, DOCX, ZIP or MP4 file',
  },
  ASSIGNMENT_SHEET: {
    maxBytes: 10 * MB,
    types: ['application/pdf', DOCX, ...IMAGES],
    describe: 'a PDF, DOCX or image file',
  },
  SUBMISSION: {
    maxBytes: 10 * MB,
    types: ['application/pdf', DOCX, ...IMAGES],
    describe: 'a PDF, DOCX or image file',
  },
};

/** The largest file any purpose accepts. */
export const MAX_UPLOAD_BYTES = Math.max(
  ...Object.values(PURPOSES).map((p) => p.maxBytes),
);

/** Uploads requested but never completed (or completed but never used) are removed after this. */
const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

export type FileSummary = {
  id: string;
  name: string;
  contentType: string;
  size: number;
};

/**
 * Uploads and downloads of private files. Callers check who may touch a file
 * (by its purpose and school) before calling in; this service checks what the
 * file is.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly urls = new Map<string, { url: string; until: number }>();
  /** null when uploads are switched off (production without R2 settings). */
  readonly driver: StorageDriver | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const get = (key: string) => config.get<string>(key)?.trim() ?? '';
    if (get('R2_BUCKET')) {
      this.driver = new R2Driver(
        get('R2_ACCOUNT_ID'),
        get('R2_ACCESS_KEY_ID'),
        get('R2_SECRET_ACCESS_KEY'),
        get('R2_BUCKET'),
      );
    } else if (get('NODE_ENV') !== 'production') {
      this.driver = new LocalDriver(localStorageRoot());
    } else {
      this.driver = null;
      this.logger.warn(
        'File uploads are off: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET to enable them.',
      );
    }
  }

  private requireDriver() {
    if (!this.driver) {
      throw new ServiceUnavailableException(
        'File uploads are not set up on this server yet',
      );
    }
    return this.driver;
  }

  /** Step 1: record the file and hand out a URL to PUT its bytes to. */
  async createUpload(
    schoolId: string,
    userId: string,
    input: {
      purpose: FilePurpose;
      name: string;
      contentType: string;
      size: number;
    },
  ) {
    const driver = this.requireDriver();
    const rule = PURPOSES[input.purpose];
    // Windows browsers report zips as application/x-zip-compressed.
    const contentType = input.contentType
      .toLowerCase()
      .replace('application/x-zip-compressed', 'application/zip');
    if (!rule.types.includes(contentType)) {
      throw new BadRequestException(`Upload ${rule.describe}`);
    }
    if (input.size <= 0 || input.size > rule.maxBytes) {
      throw new BadRequestException(
        `The file must be at most ${rule.maxBytes / MB} MB`,
      );
    }
    void this.removeAbandoned(schoolId);
    const key = `schools/${schoolId}/${input.purpose.toLowerCase().replace('_', '-')}/${randomUUID()}`;
    const file = await this.prisma.fileObject.create({
      data: {
        schoolId,
        purpose: input.purpose,
        key,
        originalName: input.name.slice(0, 200),
        contentType,
        size: input.size,
        uploadedById: userId,
      },
      select: { id: true },
    });
    return {
      fileId: file.id,
      upload: await driver.uploadUrl(key, contentType, rule.maxBytes),
    };
  }

  /**
   * Step 2, after the browser uploaded: the bytes must be there, no larger
   * than allowed, and actually be the declared type. Anything else is deleted.
   */
  async complete(
    schoolId: string,
    userId: string,
    fileId: string,
    purpose: FilePurpose,
  ): Promise<FileSummary> {
    const driver = this.requireDriver();
    const file = await this.prisma.fileObject.findFirst({
      where: { id: fileId, schoolId, purpose, uploadedById: userId },
    });
    if (!file) throw new NotFoundException('File not found');
    if (file.status === 'READY') return summary(file);

    const rule = PURPOSES[file.purpose];
    const size = await driver.size(file.key);
    const reject = async (message: string) => {
      await this.discard([file]);
      throw new BadRequestException(message);
    };
    if (size === null) return reject('The upload did not arrive. Try again.');
    if (size === 0 || size > rule.maxBytes) {
      return reject(`The file must be at most ${rule.maxBytes / MB} MB`);
    }
    const check = SIGNATURES[file.contentType];
    if (!check || !check(await driver.readStart(file.key, 16))) {
      return reject(`That file isn't ${rule.describe}`);
    }
    const ready = await this.prisma.fileObject.update({
      where: { id: file.id },
      data: { status: 'READY', size },
    });
    return summary(ready);
  }

  /** A READY file of this school and purpose, or a 400 naming the problem. */
  async findReady(schoolId: string, fileId: string, purpose: FilePurpose) {
    const file = await this.prisma.fileObject.findFirst({
      where: { id: fileId, schoolId, purpose, status: 'READY' },
    });
    if (!file) throw new BadRequestException('Upload the file again');
    return file;
  }

  /**
   * A READY file this user uploaded for `purpose` that nothing uses yet, about
   * to be attached to a record. `except` is the file the record already has
   * (re-saving it is fine).
   */
  async claim(
    schoolId: string,
    fileId: string,
    purpose: FilePurpose,
    uploadedById: string,
    except?: string | null,
  ) {
    if (fileId === except) return;
    const file = await this.prisma.fileObject.findFirst({
      where: {
        id: fileId,
        schoolId,
        purpose,
        status: 'READY',
        uploadedById,
        students: { none: {} },
        faculty: { none: {} },
        materials: { none: {} },
        assignments: { none: {} },
        submissions: { none: {} },
      },
      select: { id: true },
    });
    if (!file) throw new BadRequestException('Upload the file again');
  }

  /**
   * A short-lived URL for reading the file, or null when storage is off. The
   * same URL is handed out for a while, so a roster that refreshes every 30 s
   * doesn't make the browser download every photo again.
   */
  async url(
    file: { key: string; originalName: string; contentType: string },
    inline = true,
  ) {
    if (!this.driver) return null;
    const cacheKey = `${file.key}|${inline}`;
    const cached = this.urls.get(cacheKey);
    if (cached && cached.until > Date.now()) return cached.url;
    const url = await this.driver.downloadUrl(file.key, {
      filename: file.originalName,
      contentType: file.contentType,
      inline,
    });
    if (this.urls.size > 5000) this.urls.clear();
    // Reused for two thirds of its life, so it never expires while on screen for long.
    this.urls.set(cacheKey, {
      url,
      until: Date.now() + (DOWNLOAD_TTL_SECONDS * 1000 * 2) / 3,
    });
    return url;
  }

  /** Deletes the rows and, best effort, the bytes (a missing object is fine). */
  async discard(files: { id: string; key: string }[]) {
    if (files.length === 0) return;
    await this.prisma.fileObject.deleteMany({
      where: { id: { in: files.map((f) => f.id) } },
    });
    await this.removeObjects(files.map((f) => f.key));
  }

  /** For after a database delete that already removed the rows (e.g. a school). */
  async removeObjects(keys: string[]) {
    if (!this.driver || keys.length === 0) return;
    const driver = this.driver;
    await Promise.all(
      keys.map((key) =>
        driver.remove(key).catch((err: unknown) => {
          this.logger.warn(
            `Could not delete stored file ${key}: ${(err as Error).message}`,
          );
        }),
      ),
    );
  }

  /**
   * Housekeeping, run when a school starts a new upload: uploads never
   * completed, and files uploaded but never attached to anything.
   */
  async removeAbandoned(schoolId: string) {
    try {
      const before = new Date(Date.now() - ABANDONED_AFTER_MS);
      const stale = await this.prisma.fileObject.findMany({
        where: {
          schoolId,
          createdAt: { lt: before },
          OR: [
            { status: 'PENDING' },
            {
              students: { none: {} },
              faculty: { none: {} },
              materials: { none: {} },
              assignments: { none: {} },
              submissions: { none: {} },
            },
          ],
        },
        select: { id: true, key: true },
        take: 100,
      });
      await this.discard(stale);
    } catch (err) {
      this.logger.warn(
        `Cleanup of abandoned uploads failed: ${(err as Error).message}`,
      );
    }
  }
}

function summary(file: {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
}): FileSummary {
  return {
    id: file.id,
    name: file.originalName,
    contentType: file.contentType,
    size: file.size,
  };
}
