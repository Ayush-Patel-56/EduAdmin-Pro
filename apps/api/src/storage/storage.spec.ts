import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AccessService } from '../academic/access.service.js';
import { FilesController, LocalFilesController } from './files.controller.js';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FilesService, uploadKey } from './files.service.js';
import { LocalDriver, R2Driver, assertKey, contentDisposition } from './storage.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const config = (env: Record<string, string>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

describe('LocalDriver tokens (development stand-in for signed URLs)', () => {
  const driver = new LocalDriver(join(tmpdir(), 'eduadmin-test'));

  it('a token works only for its own operation, and not once tampered with', async () => {
    const url = (await driver.uploadUrl('schools/s/student-photo/1', 'image/png', 100)).url;
    const token = url.split('/').pop()!;
    expect(driver.verify(token, 'put')).toMatchObject({ key: 'schools/s/student-photo/1', max: 100 });
    expect(driver.verify(token, 'get')).toBeNull();
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ op: 'put', key: 'schools/other/x', exp: 9e9, ct: 'image/png', max: 1e9 })).toString('base64url');
    expect(driver.verify(`${forged}.${sig}`, 'put')).toBeNull();
    expect(driver.verify(`${body}.AAAA`, 'put')).toBeNull();
  });

  it('expired tokens are refused', () => {
    const token = driver.sign({ op: 'get', key: 'schools/s/x', exp: Math.floor(Date.now() / 1000) - 1, ct: 'image/png' });
    expect(driver.verify(token, 'get')).toBeNull();
  });

  it('keys can never leave the storage folder', () => {
    for (const bad of ['../etc/passwd', 'schools/../../x', '/abs', 'a//b', 'Upper/Case']) {
      expect(() => assertKey(bad)).toThrow();
    }
    expect(() => assertKey('schools/s1/student-photo/abc-123')).not.toThrow();
  });

  it('download names are safe in the header', () => {
    expect(contentDisposition('report "final".pdf', false)).toBe(
      `attachment; filename="report _final_.pdf"; filename*=UTF-8''report%20%22final%22.pdf`,
    );
  });
});

describe('FilesService', () => {
  let root: string;
  const create = vi.fn();
  const findFirst = vi.fn();
  const update = vi.fn();
  const deleteMany = vi.fn();
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  // The row lock taken by `complete`; the transaction runs against the same mocks.
  const queryRaw = vi.fn().mockResolvedValue([{ status: 'PENDING' }]);
  const findUniqueOrThrow = vi.fn();
  const prisma = {
    fileObject: { create, findFirst, update, updateMany, deleteMany, findUniqueOrThrow, findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: queryRaw,
    $transaction: vi.fn(),
  } as unknown as PrismaService & { $transaction: ReturnType<typeof vi.fn> };
  prisma.$transaction.mockImplementation((run: (tx: unknown) => unknown) => run(prisma));
  update.mockImplementation(({ data }: { data: object }) => ({ ...pending('schools/s/student-photo/x'), ...data }));

  beforeEach(async () => {
    vi.clearAllMocks();
    root = await mkdtemp(join(tmpdir(), 'eduadmin-files-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const service = () => {
    const files = new FilesService(prisma, config({ NODE_ENV: 'development' }));
    (files as unknown as { driver: LocalDriver }).driver = new LocalDriver(root);
    return files;
  };

  it('uploads are switched off in production without R2 settings', async () => {
    const files = new FilesService(prisma, config({ NODE_ENV: 'production' }));
    expect(files.driver).toBeNull();
    await expect(
      files.createUpload('s', 'u', { purpose: 'STUDENT_PHOTO', name: 'a.png', contentType: 'image/png', size: 10 }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses types and sizes the purpose does not allow, before recording anything', async () => {
    const files = service();
    await expect(
      files.createUpload('s', 'u', { purpose: 'STUDENT_PHOTO', name: 'a.pdf', contentType: 'application/pdf', size: 10 }),
    ).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(
      files.createUpload('s', 'u', { purpose: 'STUDENT_PHOTO', name: 'a.png', contentType: 'image/png', size: 3 * 1024 * 1024 }),
    ).rejects.toThrow(/at most 2 MB/);
    expect(create).not.toHaveBeenCalled();
  });

  const pending = (key: string) => ({
    id: 'f1', schoolId: 's', purpose: 'STUDENT_PHOTO', status: 'PENDING', key,
    originalName: 'photo.png', contentType: 'image/png', size: 16, uploadedById: 'u',
  });

  it('completes a real PNG: moves it to the key it is served from, then checks those bytes', async () => {
    const files = service();
    const key = 'schools/s/student-photo/1';
    const driver = files.driver as LocalDriver;
    await writeFile(await driver.prepare(uploadKey('f1', 's')), PNG);
    findFirst.mockResolvedValue(pending(key));
    await expect(files.complete('s', 'u', 'f1', 'STUDENT_PHOTO')).resolves.toMatchObject({ id: 'f1', size: 16 });
    // Under a row lock, so two completions can't interleave.
    expect((queryRaw.mock.calls[0][0] as string[]).join('?')).toMatch(/FROM "FileObject" WHERE "id" = \? FOR UPDATE/);
    expect(update.mock.calls[0][0]).toEqual({ where: { id: 'f1' }, data: { status: 'READY', size: 16 } });
    expect(await driver.size(key)).toBe(16);
    // The upload key is empty now: re-using the upload URL can't touch the served file.
    expect(await driver.size(uploadKey('f1', 's'))).toBeNull();
    // Only the uploader, in this school, can complete it.
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'f1', schoolId: 's', purpose: 'STUDENT_PHOTO', uploadedById: 'u' });
  });

  it('an upload sent while completing can never become the served file (#17)', async () => {
    const files = service();
    const key = 'schools/s/student-photo/race';
    const driver = files.driver as LocalDriver;
    await writeFile(await driver.prepare(uploadKey('f1', 's')), PNG);
    findFirst.mockResolvedValue(pending(key));
    // Another PUT of the same size lands under the upload key right after the bytes are checked.
    const evil = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(8)]);
    const readStart = driver.readStart.bind(driver);
    const spy = vi.spyOn(driver, 'readStart').mockImplementation(async (k: string, n: number) => {
      const start = await readStart(k, n);
      await writeFile(await driver.prepare(uploadKey('f1', 's')), evil);
      return start;
    });
    await expect(files.complete('s', 'u', 'f1', 'STUDENT_PHOTO')).resolves.toMatchObject({ id: 'f1' });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    // What is served is exactly what was checked.
    expect(await driver.readStart(key, 16)).toEqual(PNG);
    // The late bytes are removed, not left behind.
    expect(await driver.size(uploadKey('f1', 's'))).toBeNull();
  });

  it('a file that is not what it claims (a renamed PDF) is deleted, not kept', async () => {
    const files = service();
    const key = 'schools/s/student-photo/2';
    const driver = files.driver as LocalDriver;
    await writeFile(await driver.prepare(uploadKey('f1', 's')), Buffer.from('%PDF-1.7 not an image'));
    findFirst.mockResolvedValue(pending(key));
    await expect(files.complete('s', 'u', 'f1', 'STUDENT_PHOTO')).rejects.toThrow(/isn't a JPG, PNG or WebP/);
    expect(deleteMany).toHaveBeenCalled();
    expect(await driver.size(uploadKey('f1', 's'))).toBeNull();
    expect(await driver.size(key)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('a completion that waited for another one returns the READY file without touching the bytes', async () => {
    const files = service();
    const driver = files.driver as LocalDriver;
    const key = 'schools/s/student-photo/3';
    await writeFile(await driver.prepare(key), PNG); // moved and checked by the first completion
    findFirst.mockResolvedValue(pending(key));
    queryRaw.mockResolvedValueOnce([{ status: 'READY' }]);
    findUniqueOrThrow.mockResolvedValue({ ...pending(key), status: 'READY' });
    const move = vi.spyOn(driver, 'move');
    await expect(files.complete('s', 'u', 'f1', 'STUDENT_PHOTO')).resolves.toMatchObject({ id: 'f1' });
    expect(move).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(await driver.readStart(key, 16)).toEqual(PNG);
  });

  it('a missing upload is reported, and its record removed', async () => {
    const files = service();
    findFirst.mockResolvedValue(pending('schools/s/student-photo/never'));
    await expect(files.complete('s', 'u', 'f1', 'STUDENT_PHOTO')).rejects.toThrow(/did not arrive/);
    expect(deleteMany).toHaveBeenCalled();
  });

  it('the upload URL is for the upload key, never the key the file is served from', async () => {
    const files = service();
    create.mockResolvedValue({ id: 'f9' });
    const out = await files.createUpload('s', 'u', { purpose: 'STUDENT_PHOTO', name: 'a.png', contentType: 'image/png', size: 16 });
    const servedKey = create.mock.calls[0][0].data.key as string;
    const token = out.upload.url.replace('/api/files/local/', '');
    const grant = (files.driver as LocalDriver).verify(token, 'put');
    expect(grant?.key).toBe(uploadKey('f9', 's'));
    expect(grant?.key).not.toBe(servedKey);
  });
});

describe('FilesService.claim', () => {
  it("a file is attached only if it's this user's READY upload for that purpose and nothing uses it yet", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const files = new FilesService({ fileObject: { findFirst } } as unknown as PrismaService, config({ NODE_ENV: 'development' }));
    await expect(files.claim('s1', 'f1', 'STUDY_MATERIAL', 'teacher-1')).rejects.toThrow('Upload the file again');
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: 'f1',
      schoolId: 's1',
      purpose: 'STUDY_MATERIAL',
      status: 'READY',
      uploadedById: 'teacher-1',
      students: { none: {} },
      faculty: { none: {} },
      materials: { none: {} },
      assignments: { none: {} },
      submissions: { none: {} },
    });
    // The record's own current file can be saved again.
    await expect(files.claim('s1', 'f1', 'STUDY_MATERIAL', 'teacher-1', 'f1')).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('FilesService: teaching uploads', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eduadmin-files-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const run = async (contentType: string, bytes: Buffer, purpose: 'STUDY_MATERIAL' | 'SUBMISSION') => {
    const key = `schools/s/x/${Math.random().toString(36).slice(2)}`;
    const file = { id: 'f1', schoolId: 's', purpose, status: 'PENDING', key, originalName: 'f', contentType, size: bytes.length, uploadedById: 'u' };
    const prisma = {
      fileObject: {
        findFirst: vi.fn().mockResolvedValue(file),
        update: vi.fn(({ data }: { data: object }) => ({ ...file, ...data })),
        deleteMany: vi.fn(),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ status: 'PENDING' }]),
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation((go: (tx: unknown) => unknown) => go(prisma));
    const files = new FilesService(prisma as unknown as PrismaService, config({ NODE_ENV: 'development' }));
    const driver = new LocalDriver(root);
    (files as unknown as { driver: LocalDriver }).driver = driver;
    await writeFile(await driver.prepare(uploadKey('f1', 's')), bytes);
    return files.complete('s', 'u', 'f1', purpose);
  };
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(8)]);
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(12)]);

  it('accepts real PDF, DOCX (zip), ZIP and MP4 files', async () => {
    await expect(run('application/pdf', Buffer.from('%PDF-1.7 ....'), 'STUDY_MATERIAL')).resolves.toMatchObject({ id: 'f1' });
    await expect(run('application/vnd.openxmlformats-officedocument.wordprocessingml.document', zip, 'SUBMISSION')).resolves.toMatchObject({ id: 'f1' });
    await expect(run('application/zip', zip, 'STUDY_MATERIAL')).resolves.toMatchObject({ id: 'f1' });
    await expect(run('video/mp4', mp4, 'STUDY_MATERIAL')).resolves.toMatchObject({ id: 'f1' });
  });

  it('rejects a file whose bytes are not what it claims (a zip named .mp4, a text file named .pdf)', async () => {
    await expect(run('video/mp4', zip, 'STUDY_MATERIAL')).rejects.toBeInstanceOf(BadRequestException);
    await expect(run('application/pdf', Buffer.from('hello world, not a pdf'), 'SUBMISSION')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('study material may be 50 MB; a video is not a valid submission', async () => {
    const prisma = { fileObject: { create: vi.fn().mockResolvedValue({ id: 'f' }), findMany: vi.fn().mockResolvedValue([]) } } as unknown as PrismaService;
    const files = new FilesService(prisma, config({ NODE_ENV: 'development' }));
    (files as unknown as { driver: LocalDriver }).driver = new LocalDriver(root);
    await expect(files.createUpload('s', 'u', { purpose: 'STUDY_MATERIAL', name: 'lecture.mp4', contentType: 'video/mp4', size: 49 * 1024 * 1024 })).resolves.toHaveProperty('fileId');
    await expect(files.createUpload('s', 'u', { purpose: 'STUDY_MATERIAL', name: 'big.mp4', contentType: 'video/mp4', size: 51 * 1024 * 1024 })).rejects.toThrow(/50 MB/);
    await expect(files.createUpload('s', 'u', { purpose: 'SUBMISSION', name: 'a.mp4', contentType: 'video/mp4', size: 10 })).rejects.toThrow(/PDF, DOCX or image/);
    // Windows reports zips as application/x-zip-compressed.
    await expect(files.createUpload('s', 'u', { purpose: 'STUDY_MATERIAL', name: 'a.zip', contentType: 'application/x-zip-compressed', size: 10 })).resolves.toHaveProperty('fileId');
  });
});

describe('FilesController: who may upload what', () => {
  const build = (access: Partial<AccessService>) =>
    new FilesController(access as AccessService, { createUpload: vi.fn().mockResolvedValue({}) } as never);
  const auth = { userId: 'u', sessionId: 's', activeSchoolId: null };
  const body = (purpose: string) => ({ purpose, name: 'f', contentType: 'application/pdf', size: 10 }) as never;

  it('teaching uploads need an active teacher of this very school', async () => {
    const inactive = build({ teacherScope: vi.fn().mockResolvedValue({ schoolId: 's1', active: false }) });
    await expect(inactive.create(auth, 's1', body('STUDY_MATERIAL'))).rejects.toBeInstanceOf(ForbiddenException);
    const otherSchool = build({ teacherScope: vi.fn().mockResolvedValue({ schoolId: 's2', active: true }) });
    await expect(otherSchool.create(auth, 's1', body('SUBMISSION'))).rejects.toBeInstanceOf(ForbiddenException);
    const ok = build({ teacherScope: vi.fn().mockResolvedValue({ schoolId: 's1', active: true }) });
    await expect(ok.create(auth, 's1', body('ASSIGNMENT_SHEET'))).resolves.toBeDefined();
    // An admin (no faculty profile) is told plainly, not "Join a school".
    const admin = build({ teacherScope: vi.fn().mockRejectedValue(new ForbiddenException('Join a school')) });
    await expect(admin.create(auth, 's1', body('STUDY_MATERIAL'))).rejects.toThrow('Only active faculty of this school can upload this');
  });

  it('a faculty photo: a teacher of the school, otherwise only an admin', async () => {
    const assertAdmin = vi.fn().mockRejectedValue(new ForbiddenException('admins only'));
    const outsider = build({ teacherScope: vi.fn().mockRejectedValue(new ForbiddenException('no school')), assertAdmin });
    await expect(outsider.create(auth, 's1', body('FACULTY_PHOTO'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(assertAdmin).toHaveBeenCalledWith('u', 's1');
    const teacher = build({ teacherScope: vi.fn().mockResolvedValue({ schoolId: 's1', facultyId: 'f', active: true }), assertAdmin });
    await expect(teacher.create(auth, 's1', body('FACULTY_PHOTO'))).resolves.toBeDefined();
  });

  it('a student photo is admin-only', async () => {
    const assertAdmin = vi.fn().mockRejectedValue(new ForbiddenException('admins only'));
    const teacher = build({ teacherScope: vi.fn().mockResolvedValue({ schoolId: 's1', facultyId: 'f', active: true }), assertAdmin });
    await expect(teacher.create(auth, 's1', body('STUDENT_PHOTO'))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('upload URLs', () => {
  it('R2: the signed PUT carries Content-Length, so a bigger file is refused by R2 itself', async () => {
    const r2 = new R2Driver('acc', 'key', 'secret', 'bucket');
    const { url, headers } = await r2.uploadUrl('uploads/s/f1', 'image/png', 1234);
    expect(new URL(url).searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
    expect(headers).toEqual({ 'Content-Type': 'image/png' });
  });

  it('local: the upload link is dead once the file is no longer pending', async () => {
    const acceptsUpload = vi.fn().mockResolvedValue(false);
    const driver = new LocalDriver(join(tmpdir(), 'eduadmin-test'));
    const controller = new LocalFilesController({ driver, acceptsUpload } as unknown as FilesService);
    const { url } = await driver.uploadUrl('uploads/s/f1', 'image/png', 16);
    await expect(controller.upload(url.split('/').pop()!, { headers: { 'content-length': '16' } } as never)).rejects.toThrow('already finished');
    expect(acceptsUpload).toHaveBeenCalledWith('uploads/s/f1');
  });

  it('local: the PUT must be exactly the approved size', async () => {
    const driver = new LocalDriver(join(tmpdir(), 'eduadmin-test'));
    const controller = new LocalFilesController({ driver, acceptsUpload: vi.fn().mockResolvedValue(true) } as unknown as FilesService);
    const { url } = await driver.uploadUrl('uploads/s/f2', 'image/png', 16);
    await expect(controller.upload(url.split('/').pop()!, { headers: { 'content-length': '5000000' } } as never)).rejects.toThrow('does not match');
  });
});
