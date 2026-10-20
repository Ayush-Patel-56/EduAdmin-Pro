import { Body, Controller, Delete, Get, Put, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AVATAR_MAX_BYTES, AvatarService } from './avatar.service.js';
import { Auth, type AuthContext, SessionGuard } from './session.guard.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AvatarUploadDto {
  /** The resized picture as a data URL (data:image/jpeg|png|webp;base64,…). */
  @IsString()
  @IsNotEmpty({ message: 'Choose an image' })
  @MaxLength(Math.ceil((AVATAR_MAX_BYTES * 4) / 3) + 64, { message: 'The image is too large: keep it under 256 KB' })
  image: string;
}

export class AvatarLinkDto {
  @Transform(trim)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Paste an https:// link to an image' })
  @MaxLength(500, { message: 'Keep the link under 500 characters' })
  url: string;
}

/** The signed-in account's profile picture. Always the caller's own: nothing here takes a user id. */
@Controller('auth/avatar')
@UseGuards(SessionGuard)
export class AvatarController {
  constructor(private readonly avatars: AvatarService) {}

  /** The uploaded picture; never stored by the browser, so a shared computer keeps nothing after sign-out (#54). */
  @Get()
  async read(@Auth() auth: AuthContext, @Res() res: Response) {
    const { contentType, data } = await this.avatars.read(auth.userId);
    res.set({ 'Content-Type': contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
    res.send(data);
  }

  @Put('upload')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  upload(@Auth() auth: AuthContext, @Body() dto: AvatarUploadDto) {
    return this.avatars.upload(auth.userId, dto.image);
  }

  @Put('link')
  link(@Auth() auth: AuthContext, @Body() dto: AvatarLinkDto) {
    return this.avatars.link(auth.userId, dto.url);
  }

  @Delete()
  remove(@Auth() auth: AuthContext) {
    return this.avatars.remove(auth.userId);
  }
}
