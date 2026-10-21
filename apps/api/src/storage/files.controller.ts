import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Transform } from 'node:stream';
import {
  Body,
  ForbiddenException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '../throttler/index.js';
import type { Request, Response } from 'express';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import type { FilePurpose } from '../generated/prisma/client.js';
import { CompleteUploadDto, CreateUploadDto } from './files.dto.js';
import { FilesService } from './files.service.js';
import { LocalDriver, contentDisposition } from './storage.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

/**
 * Uploading a file: request an upload (who may upload depends on what the
 * file is for), PUT the bytes to the returned URL, then complete it.
 */
@Controller('schools/:schoolId/files')
@UseGuards(SessionGuard)
export class FilesController {
  constructor(
    private readonly access: AccessService,
    private readonly files: FilesService,
  ) {}

  private async authorize(
    userId: string,
    schoolId: string,
    purpose: FilePurpose,
  ) {
    switch (purpose) {
      case 'STUDENT_PHOTO':
        // Only admins edit student records.
        await this.access.assertAdmin(userId, schoolId);
        return;
      case 'FACULTY_PHOTO': {
        // Admins edit any profile; a teacher edits their own.
        const teacher = await this.access
          .teacherScope(userId)
          .catch(() => null);
        if (teacher?.facultyId && teacher.schoolId === schoolId) return;
        await this.access.assertAdmin(userId, schoolId);
        return;
      }
      case 'STUDY_MATERIAL':
      case 'ASSIGNMENT_SHEET':
      case 'SUBMISSION': {
        // Teaching uploads come from active faculty of this school (admins
        // see and preview them, they don't upload them).
        const teacher = await this.access.teacherScope(userId).catch(() => null);
        if (!teacher || teacher.schoolId !== schoolId || !teacher.active) {
          throw new ForbiddenException('Only active faculty of this school can upload this');
        }
        return;
      }
    }
  }

  @Post()
  async create(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: CreateUploadDto,
  ) {
    await this.authorize(auth.userId, schoolId, dto.purpose);
    return this.files.createUpload(schoolId, auth.userId, dto);
  }

  @Post(':fileId/complete')
  @HttpCode(200)
  async complete(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('fileId') fileId: string,
    @Body() dto: CompleteUploadDto,
  ) {
    await this.authorize(auth.userId, schoolId, dto.purpose);
    const file = await this.files.complete(
      schoolId,
      auth.userId,
      fileId,
      dto.purpose,
    );
    const ready = await this.files.findReady(schoolId, file.id, dto.purpose);
    return { ...file, url: await this.files.url(ready) };
  }
}

/**
 * Development storage: stands in for R2's signed URLs. The token in the path
 * is the authorization (signed by this process, valid for minutes), exactly
 * like a presigned R2 URL, so these routes take no session.
 */
@Controller('files/local')
@SkipThrottle()
export class LocalFilesController {
  constructor(private readonly files: FilesService) {}

  private driver() {
    const driver = this.files.driver;
    if (!(driver instanceof LocalDriver)) throw new NotFoundException();
    return driver;
  }

  @Put(':token')
  @HttpCode(204)
  async upload(@Param('token') token: string, @Req() req: Request) {
    const driver = this.driver();
    const grant = driver.verify(token, 'put');
    if (!grant) throw new HttpException('Upload link expired', 403);
    // Like a one-time ticket: once the file is completed (or gone) the link is dead.
    if (!(await this.files.acceptsUpload(grant.key))) {
      throw new HttpException('This upload is already finished', 409);
    }
    // Exactly the approved size, as R2 enforces through the signed Content-Length.
    const declared = Number(req.headers['content-length'] ?? NaN);
    if (declared !== grant.max) {
      throw new HttpException('The file size does not match the upload', HttpStatus.BAD_REQUEST);
    }
    const target = await driver.prepare(grant.key);
    const partial = `${target}.part`;
    let received = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, done) {
        received += chunk.length;
        if (received > (grant.max ?? 0)) {
          done(new HttpException('File too large', HttpStatus.PAYLOAD_TOO_LARGE));
        } else done(null, chunk);
      },
    });
    try {
      await pipeline(req, limit, createWriteStream(partial));
      await rename(partial, target);
    } catch (err) {
      await rm(partial, { force: true });
      throw err;
    }
  }

  @Get(':token')
  download(@Param('token') token: string, @Res() res: Response) {
    const driver = this.driver();
    const grant = driver.verify(token, 'get');
    if (!grant) throw new HttpException('Link expired', 403);
    const stream = driver.open(grant.key);
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.destroy();
    });
    stream.on('open', () => {
      res.setHeader('Content-Type', grant.ct);
      res.setHeader(
        'Content-Disposition',
        contentDisposition(grant.fn ?? 'file', grant.inline ?? false),
      );
      res.setHeader('Cache-Control', 'private, max-age=300');
      // Served to the web app's <img> and download links.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      stream.pipe(res);
    });
  }
}
