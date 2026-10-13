import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FilesService, uploadKey } from './files.service.js';
import { LocalDriver, R2Driver, assertKey, contentDisposition } from './storage.js';
import { LocalFilesController } from './files.controller.js';

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
  const prisma = {
    fileObject: { create, findFirst, update, updateMany, deleteMany, findMany: vi.fn().mockResolvedValue([]) },
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

  it('completes a real PNG: checks the upload, then moves it to the key it is served from', async () => {
    const files = service();
    const key = 'schools/s/student-photo/1';
    const driver = files.driver as LocalDriver;
    await writeFile(await driver.prepare(uploadKey('f1', 's')), PNG);
    findFirst.mockResolvedValue(pending(key));
    await expect(files.complete('s', 'u', 'f1', 'STUDENT_PHOTO')).resolves.toMatchObject({ id: 'f1', size: 16 });
    expect(updateMany.mock.calls[0][0]).toEqual({ where: { id: 'f1', status: 'PENDING' }, data: { status: 'READY', size: 16 } });
    expect(await driver.size(key)).toBe(16);
    // The upload key is empty now: re-using the upload URL can't touch the served file.
    expect(await driver.size(uploadKey('f1', 's'))).toBeNull();
    // Only the uploader, in this school, can complete it.
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'f1', schoolId: 's', purpose: 'STUDENT_PHOTO', uploadedById: 'u' });
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
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('of two simultaneous completions only one moves the bytes', async () => {
    const files = service();
    const driver = files.driver as LocalDriver;
    await writeFile(await driver.prepare(uploadKey('f1', 's')), PNG);
    findFirst.mockResolvedValue(pending('schools/s/student-photo/3'));
    updateMany.mockResolvedValueOnce({ count: 0 });
    (prisma.fileObject as unknown as { findUniqueOrThrow: unknown }).findUniqueOrThrow = vi.fn().mockResolvedValue({ ...pending('schools/s/student-photo/3'), status: 'READY' });
    await files.complete('s', 'u', 'f1', 'STUDENT_PHOTO');
    expect(await driver.size('schools/s/student-photo/3')).toBeNull();
  });

  it('a missing upload is reported, and its record removed', async () => {
    const files = service();
    findFirst.mockResolvedValue(pending('schools/s/student-photo/never'));
    await expect(files.complete('s', 'u', 'f1', 'STUDENT_PHOTO')).rejects.toThrow(/did not arrive/);
    expect(deleteMany).toHaveBeenCalled();
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
