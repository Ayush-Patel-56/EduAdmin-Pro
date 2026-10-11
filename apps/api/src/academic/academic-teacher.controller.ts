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
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SyllabusImportDto,
  SyllabusItemDto,
  SyllabusStatusDto,
} from './academic.dto.js';
import { AccessService } from './access.service.js';
import { loadStructure } from './structure.js';
import { SyllabusService } from './syllabus.service.js';

/**
 * The faculty side of academic planning. The school and the batches a teacher
 * may touch always come from their own membership and assignments, never
 * from the request.
 */
@Controller('teacher')
@UseGuards(SessionGuard)
export class AcademicTeacherController {
  constructor(
    private readonly access: AccessService,
    private readonly prisma: PrismaService,
    private readonly syllabus: SyllabusService,
  ) {}

  /** The teacher's assigned programs and batches, for the sidebar filters. */
  @Get('structure')
  async structure(@Auth() auth: AuthContext) {
    const scope = await this.access.teacherScope(auth.userId);
    return loadStructure(this.prisma, scope.schoolId, scope);
  }

  @Get('syllabus')
  async list(
    @Auth() auth: AuthContext,
    @Query('batchId', ParseUUIDPipe) batchId: string,
    @Query('subject') subject?: string,
  ) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.syllabus.list(scope.schoolId, scope.batchIds, batchId, subject);
  }

  @Post('syllabus')
  async create(@Auth() auth: AuthContext, @Body() dto: SyllabusItemDto) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.syllabus.create(
      scope.schoolId,
      scope.batchIds,
      auth.userId,
      dto,
    );
  }

  @Post('syllabus/import')
  @HttpCode(200)
  async import(@Auth() auth: AuthContext, @Body() dto: SyllabusImportDto) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.syllabus.import(
      scope.schoolId,
      scope.batchIds,
      auth.userId,
      dto,
    );
  }

  @Patch('syllabus/:itemId')
  async update(
    @Auth() auth: AuthContext,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: SyllabusItemDto,
  ) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.syllabus.update(
      scope.schoolId,
      scope.batchIds,
      auth.userId,
      itemId,
      dto,
    );
  }

  @Patch('syllabus/:itemId/status')
  async setStatus(
    @Auth() auth: AuthContext,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: SyllabusStatusDto,
  ) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.syllabus.setStatus(
      scope.schoolId,
      scope.batchIds,
      auth.userId,
      itemId,
      dto.status,
    );
  }

  @Delete('syllabus/:itemId')
  async remove(
    @Auth() auth: AuthContext,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.syllabus.remove(scope.schoolId, scope.batchIds, itemId);
  }
}
