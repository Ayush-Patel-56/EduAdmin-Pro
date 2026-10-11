import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { SUBJECTS } from '../academic/academic-options.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import {
  ChapterDto,
  ConceptDto,
  CurriculumImportDto,
} from './curriculum.dto.js';
import { CurriculumService } from './curriculum.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

function subjectParam(value: string | undefined, required: boolean) {
  if (!value) {
    if (required) throw new BadRequestException('Select a subject');
    return undefined;
  }
  if (!(SUBJECTS as readonly string[]).includes(value)) {
    throw new BadRequestException('Unknown subject');
  }
  return value;
}

/**
 * The school's curriculum (PRD §4.3), for admins. Every route checks the
 * caller is an active admin of :schoolId and every query is scoped by it.
 */
@Controller('schools/:schoolId/curriculum')
@UseGuards(SessionGuard)
export class CurriculumController {
  constructor(
    private readonly access: AccessService,
    private readonly curriculum: CurriculumService,
  ) {}

  @Get('options')
  async options(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.curriculum.options(schoolId);
  }

  @Get('chapters')
  async chapters(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Query('subject') subject?: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.curriculum.listChapters(schoolId, subjectParam(subject, true)!);
  }

  @Post('chapters')
  async createChapter(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: ChapterDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.curriculum.createChapter(schoolId, dto);
  }

  @Patch('chapters/:chapterId')
  async updateChapter(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('chapterId') chapterId: string,
    @Body() dto: ChapterDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.curriculum.updateChapter(schoolId, chapterId, dto);
  }

  @Delete('chapters/:chapterId')
  async deleteChapter(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('chapterId') chapterId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.curriculum.deleteChapter(schoolId, chapterId);
  }

  @Get('chapters/:chapterId/concepts')
  async concepts(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('chapterId') chapterId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.curriculum.listConcepts(schoolId, chapterId);
  }

  @Post('chapters/:chapterId/concepts')
  async createConcept(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('chapterId') chapterId: string,
    @Body() dto: ConceptDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.curriculum.createConcept(schoolId, chapterId, dto);
  }

  @Patch('concepts/:conceptId')
  async updateConcept(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('conceptId') conceptId: string,
    @Body() dto: ConceptDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.curriculum.updateConcept(schoolId, conceptId, dto);
  }

  @Delete('concepts/:conceptId')
  async deleteConcept(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('conceptId') conceptId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.curriculum.deleteConcept(schoolId, conceptId);
  }

  @Get('master')
  async master(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Query('subject') subject?: string,
    @Query('board') board?: string,
    @Query('classLevel') classLevel?: string,
    @Query('programId', new ParseUUIDPipe({ optional: true }))
    programId?: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.curriculum.master(schoolId, {
      subject: subjectParam(subject, false),
      board: board || undefined,
      classLevel: classLevel || undefined,
      programId,
    });
  }

  @Post('import')
  @HttpCode(200)
  async import(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: CurriculumImportDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.curriculum.import(schoolId, dto);
  }
}
