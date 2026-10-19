import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AvatarLinkDto, AvatarUploadDto } from './avatar.controller.js';
import { AVATAR_MAX_BYTES, AvatarService, avatarUrlOf, parseImageDataUrl, sniffImage } from './avatar.service.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const dataUrl = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString('base64')}`;

describe('profile picture: what is accepted', () => {
  it('knows an image by its bytes, not its name', () => {
    expect([sniffImage(PNG), sniffImage(JPEG), sniffImage(WEBP), sniffImage(Buffer.from('GIF89a'))]).toEqual(['image/png', 'image/jpeg', 'image/webp', null]);
  });

  it('takes a JPEG, PNG or WebP data URL whose bytes match its type, up to 256 KB', () => {
    expect(parseImageDataUrl(dataUrl('image/png', PNG))).toMatchObject({ contentType: 'image/png' });
    expect(parseImageDataUrl(dataUrl('image/webp', WEBP)).data.equals(WEBP)).toBe(true);
    // A GIF, an SVG (could carry script), HTML called an image, or something too large: refused.
    expect(() => parseImageDataUrl(dataUrl('image/gif', Buffer.from('GIF89a')))).toThrow(BadRequestException);
    expect(() => parseImageDataUrl(dataUrl('image/svg+xml', Buffer.from('<svg onload=alert(1)>')))).toThrow('Choose a JPEG, PNG or WebP image');
    expect(() => parseImageDataUrl(dataUrl('image/png', Buffer.from('<html><script>')))).toThrow("That file isn't a valid JPEG, PNG or WebP image");
    expect(() => parseImageDataUrl(dataUrl('image/jpeg', PNG))).toThrow("isn't a valid");
    expect(() => parseImageDataUrl(dataUrl('image/png', Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES)])))).toThrow('keep it under 256 KB');
  });

  it('a link must be https, and short', () => {
    const errors = (url: string) => validateSync(plainToInstance(AvatarLinkDto, { url })).map((e) => e.property);
    expect(errors(' https://images.example.com/me.png ')).toEqual([]);
    expect(errors('http://images.example.com/me.png')).toEqual(['url']);
    expect(errors('javascript:alert(1)')).toEqual(['url']);
    expect(errors(`https://x.example.com/${'a'.repeat(500)}`)).toEqual(['url']);
    expect(validateSync(plainToInstance(AvatarUploadDto, { image: '' })).map((e) => e.property)).toEqual(['image']);
  });

  it('the portal shows the upload (versioned, so a new one is not cached over), else the link, else nothing', () => {
    expect(avatarUrlOf({ avatarUrl: 'https://x.example/a.png', avatar: { updatedAt: new Date(1700000000000) } })).toBe('/api/auth/avatar?v=1700000000000');
    expect(avatarUrlOf({ avatarUrl: 'https://x.example/a.png', avatar: null })).toBe('https://x.example/a.png');
    expect(avatarUrlOf({ avatarUrl: null, avatar: null })).toBeNull();
  });
});

describe('AvatarService: always the caller’s own picture', () => {
  const build = () => {
    const prisma = {
      userAvatar: { findUnique: vi.fn(), upsert: vi.fn().mockResolvedValue({ updatedAt: new Date(5) }), deleteMany: vi.fn() },
      user: { update: vi.fn() },
      $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    return { prisma, service: new AvatarService(prisma as unknown as PrismaService) };
  };

  it('an upload replaces the link; a link replaces the upload; remove clears both', async () => {
    const { prisma, service } = build();
    await expect(service.upload('u1', dataUrl('image/png', PNG))).resolves.toEqual({ avatarUrl: '/api/auth/avatar?v=5' });
    expect(prisma.userAvatar.upsert.mock.calls[0][0]).toMatchObject({ where: { userId: 'u1' }, create: { userId: 'u1', contentType: 'image/png' } });
    expect(prisma.user.update.mock.calls[0][0]).toEqual({ where: { id: 'u1' }, data: { avatarUrl: null } });
    await expect(service.link('u1', 'https://x.example/me.png')).resolves.toEqual({ avatarUrl: 'https://x.example/me.png' });
    expect(prisma.userAvatar.deleteMany.mock.calls[0][0]).toEqual({ where: { userId: 'u1' } });
    await expect(service.remove('u1')).resolves.toEqual({ avatarUrl: null });
    expect(prisma.user.update.mock.calls.at(-1)![0]).toEqual({ where: { id: 'u1' }, data: { avatarUrl: null } });
  });

  it('reads only the caller’s upload; none is a 404', async () => {
    const { prisma, service } = build();
    prisma.userAvatar.findUnique.mockResolvedValueOnce({ contentType: 'image/png', data: new Uint8Array(PNG) }).mockResolvedValueOnce(null);
    await expect(service.read('u1')).resolves.toMatchObject({ contentType: 'image/png' });
    expect(prisma.userAvatar.findUnique.mock.calls[0][0].where).toEqual({ userId: 'u1' });
    await expect(service.read('u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a bad image is refused before anything is written', async () => {
    const { prisma, service } = build();
    await expect(service.upload('u1', dataUrl('image/png', Buffer.from('nope')))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
