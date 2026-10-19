import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** The largest picture kept (the browser resizes it to 256 px first, so it is usually far smaller). */
export const AVATAR_MAX_BYTES = 256 * 1024;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AvatarType = (typeof AVATAR_TYPES)[number];

/** What the bytes are, from their signature (never trusting the declared type). */
export function sniffImage(bytes: Buffer): AvatarType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** A data URL (data:image/…;base64,…) as image bytes, checked: a known type whose signature matches, within the size limit. */
export function parseImageDataUrl(dataUrl: string): { contentType: AvatarType; data: Buffer } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new BadRequestException('Choose a JPEG, PNG or WebP image');
  const data = Buffer.from(match[2], 'base64');
  if (!data.length) throw new BadRequestException('The image is empty');
  if (data.length > AVATAR_MAX_BYTES) throw new BadRequestException('The image is too large: keep it under 256 KB');
  const actual = sniffImage(data);
  if (!actual || actual !== match[1]) throw new BadRequestException("That file isn't a valid JPEG, PNG or WebP image");
  return { contentType: actual, data };
}

/** Where the portal finds a user's picture: their upload (versioned, so a new one isn't cached over), else their link. */
export function avatarUrlOf(user: { avatarUrl: string | null; avatar: { updatedAt: Date } | null }): string | null {
  if (user.avatar) return `/api/auth/avatar?v=${user.avatar.updatedAt.getTime()}`;
  return user.avatarUrl;
}

/**
 * A profile picture for the signed-in account: a link to an image hosted
 * online, or a small uploaded image kept with the account (an account spans
 * schools, so it isn't in any one school's storage). Only the account itself
 * reads or changes it.
 */
@Injectable()
export class AvatarService {
  constructor(private readonly prisma: PrismaService) {}

  async read(userId: string) {
    const avatar = await this.prisma.userAvatar.findUnique({ where: { userId }, select: { contentType: true, data: true } });
    if (!avatar) throw new NotFoundException('No profile picture');
    return { contentType: avatar.contentType, data: Buffer.from(avatar.data) };
  }

  /** An uploaded picture replaces any link. */
  async upload(userId: string, dataUrl: string) {
    const { contentType, data } = parseImageDataUrl(dataUrl);
    const bytes = new Uint8Array(data);
    const [avatar] = await this.prisma.$transaction([
      this.prisma.userAvatar.upsert({ where: { userId }, create: { userId, contentType, data: bytes }, update: { contentType, data: bytes }, select: { updatedAt: true } }),
      this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } }),
    ]);
    return { avatarUrl: avatarUrlOf({ avatarUrl: null, avatar }) };
  }

  /** A link replaces any uploaded picture. */
  async link(userId: string, url: string) {
    await this.prisma.$transaction([
      this.prisma.userAvatar.deleteMany({ where: { userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: url } }),
    ]);
    return { avatarUrl: url };
  }

  async remove(userId: string) {
    await this.prisma.$transaction([this.prisma.userAvatar.deleteMany({ where: { userId } }), this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } })]);
    return { avatarUrl: null };
  }
}
