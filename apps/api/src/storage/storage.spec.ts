import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AccessService } from '../academic/access.service.js';
import { FilesController } from './files.controller.js';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FilesService } from './files.service.js';
import { LocalDriver, assertKey, contentDisposition } from './storage.js';

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
  const prisma = {
    fileObject: { create, findFirst, update, deleteMany, findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;

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

  it('completes a real PNG and marks it READY with the stored size', async () => {
    const files = service();
    const key = 'schools/s/student-photo/1';
    const driver = files.driver as LocalDriver;
    await writeFile(await driver.prepare(key), PNG);
    findFirst.mockResolvedValue(pending(key));
    update.mockImplementation(({ data }: { data: object }) => ({ ...pending(key), ...data }));
    await expect(files.complete('s', 'u', 'f1', 'STUDENT_PHOTO')).resolves.toMatchObject({ id: 'f1', size: 16 });
    expect(update.mock.calls[0][0].data).toEqual({ status: 'READY', size: 16 });
    // Only the uploader, in this school, can complete it.
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'f1', schoolId: 's', purpose: 'STUDENT_PHOTO', uploadedById: 'u' });
  });

  it('a file that is not what it claims (a renamed PDF) is deleted, not kept', async () => {
    const files = service();
    const key = 'schools/s/student-photo/2';
    const driver = files.driver as LocalDriver;
    await writeFile(await driver.prepare(key), Buffer.from('%PDF-1.7 not an image'));
    findFirst.mockResolvedValue(pending(key));
    await expect(files.complete('s', 'u', 'f1', 'STUDENT_PHOTO')).rejects.toBeInstanceOf(BadRequestException);
    expect(deleteMany).toHaveBeenCalled();
    expect(await driver.size(key)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('a missing upload is reported, and its record removed', async () => {
    const files = service();
    findFirst.mockResolvedValue(pending('schools/s/student-photo/never'));
    await expect(files.complete('s', 'u', 'f1', 'STUDENT_PHOTO')).rejects.toThrow(/did not arrive/);
    expect(deleteMany).toHaveBeenCalled();
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
        update: vi.fn().mockImplementation(({ data }: { data: object }) => ({ ...file, ...data })),
        deleteMany: vi.fn(),
      },
    } as unknown as PrismaService;
    const files = new FilesService(prisma, config({ NODE_ENV: 'development' }));
    const driver = new LocalDriver(root);
    (files as unknown as { driver: LocalDriver }).driver = driver;
    await writeFile(await driver.prepare(key), bytes);
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
