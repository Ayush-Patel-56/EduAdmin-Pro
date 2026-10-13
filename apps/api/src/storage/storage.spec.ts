import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
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
