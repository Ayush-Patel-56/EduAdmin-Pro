import {
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
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import {
  BatchDto,
  DeleteFacultyDto,
  FacultyImportDto,
  ProgramDto,
  PromotionDecisionDto,
  SyllabusImportDto,
  SyllabusItemDto,
  SyllabusStatusDto,
} from './academic.dto.js';
import { AccessService } from './access.service.js';
import { BatchesService } from './batches.service.js';
import { FacultyService } from './faculty.service.js';
import { ProgramsService } from './programs.service.js';
import { PromotionService } from './promotion.service.js';
import { loadStructure } from './structure.js';
import { SyllabusService } from './syllabus.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);
const OptionalUuid = (name: string) =>
  Query(name, new ParseUUIDPipe({ optional: true }));

/**
 * Academic planning for school admins. Every route starts with assertAdmin,
 * and every service call is scoped by the :schoolId it checked.
 */
@Controller('schools/:schoolId')
@UseGuards(SessionGuard)
export class AcademicAdminController {
  constructor(
    private readonly access: AccessService,
    private readonly prisma: PrismaService,
    private readonly programs: ProgramsService,
    private readonly batches: BatchesService,
    private readonly faculty: FacultyService,
    private readonly syllabus: SyllabusService,
    private readonly promotion: PromotionService,
  ) {}

  @Get('structure')
  async structure(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return loadStructure(this.prisma, schoolId);
  }

  // Programs

  @Get('programs')
  async listPrograms(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.programs.list(schoolId);
  }

  @Post('programs')
  async createProgram(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: ProgramDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.programs.create(schoolId, dto);
  }

  @Patch('programs/:programId')
  async updateProgram(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('programId') programId: string,
    @Body() dto: ProgramDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.programs.update(schoolId, programId, dto);
  }

  @Delete('programs/:programId')
  async deleteProgram(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('programId') programId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.programs.remove(schoolId, programId);
  }

  // Batches

  @Get('batches')
  async listBatches(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @OptionalUuid('programId') programId?: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.batches.list(schoolId, programId);
  }

  @Post('batches')
  async createBatch(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: BatchDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.batches.create(schoolId, dto);
  }

  @Patch('batches/:batchId')
  async updateBatch(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('batchId') batchId: string,
    @Body() dto: BatchDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.batches.update(schoolId, batchId, dto);
  }

  @Delete('batches/:batchId')
  async deleteBatch(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('batchId') batchId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.batches.remove(schoolId, batchId);
  }

  // Faculty

  @Get('faculty')
  async listFaculty(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.faculty.list(schoolId);
  }

  @Post('faculty/import')
  @HttpCode(200)
  async importFaculty(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: FacultyImportDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.faculty.import(schoolId, dto.rows, dto.dryRun);
  }

  // POST, not DELETE: some proxies drop a DELETE request's body.
  @Post('faculty/delete')
  @HttpCode(200)
  async deleteFaculty(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: DeleteFacultyDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.faculty.remove(schoolId, dto.ids);
  }

  // Syllabus tracker (admins see every batch: scope null)

  @Get('syllabus')
  async listSyllabus(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Query('batchId', ParseUUIDPipe) batchId: string,
    @Query('subject') subject?: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.syllabus.list(schoolId, null, batchId, subject);
  }

  @Post('syllabus')
  async createChapter(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: SyllabusItemDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.syllabus.create(schoolId, null, auth.userId, dto);
  }

  @Post('syllabus/import')
  @HttpCode(200)
  async importSyllabus(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: SyllabusImportDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.syllabus.import(schoolId, null, auth.userId, dto);
  }

  @Patch('syllabus/:itemId')
  async updateChapter(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('itemId') itemId: string,
    @Body() dto: SyllabusItemDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.syllabus.update(schoolId, null, auth.userId, itemId, dto);
  }

  @Patch('syllabus/:itemId/status')
  async setChapterStatus(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('itemId') itemId: string,
    @Body() dto: SyllabusStatusDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.syllabus.setStatus(
      schoolId,
      null,
      auth.userId,
      itemId,
      dto.status,
    );
  }

  @Delete('syllabus/:itemId')
  async deleteChapter(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('itemId') itemId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.syllabus.remove(schoolId, null, itemId);
  }

  // Promotion

  @Get('promotion')
  async promotionOverview(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.promotion.overview(schoolId);
  }

  @Post('promotion/confirm')
  @HttpCode(200)
  async confirmPromotion(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: PromotionDecisionDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.promotion.decide(
      schoolId,
      auth.userId,
      dto.academicYear,
      'CONFIRMED',
    );
  }

  @Post('promotion/dismiss')
  @HttpCode(200)
  async dismissPromotion(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: PromotionDecisionDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.promotion.decide(
      schoolId,
      auth.userId,
      dto.academicYear,
      'DISMISSED',
    );
  }
}
