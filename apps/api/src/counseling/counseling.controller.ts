import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import {
  COUNSELING_STATUSES,
  COUNSELING_TYPES,
  CounselingQuery,
  ScheduleSessionDto,
  SessionFields,
  SessionStatusDto,
  TeacherSessionDto,
} from './counseling.dto.js';
import { CounselingService } from './counseling.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

@Controller('counseling')
@UseGuards(SessionGuard)
export class CounselingOptionsController {
  @Get('options')
  options() {
    return { types: COUNSELING_TYPES, statuses: COUNSELING_STATUSES };
  }
}

/** Counseling Sessions for admins (PRD 4.13). Every route checks the caller is an admin of :schoolId first. */
@Controller('schools/:schoolId/counseling')
@UseGuards(SessionGuard)
export class AdminCounselingController {
  constructor(
    private readonly access: AccessService,
    private readonly counseling: CounselingService,
  ) {}

  @Get()
  async list(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Query() query: CounselingQuery,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.counseling.adminList(schoolId, query);
  }

  @Get('counselors')
  async counselors(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.counseling.counselors(schoolId);
  }

  @Post()
  async schedule(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: ScheduleSessionDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.counseling.schedule(schoolId, auth.userId, dto);
  }

  @Patch(':sessionId')
  async update(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('sessionId') sessionId: string,
    @Body() dto: ScheduleSessionDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.counseling.update(schoolId, sessionId, dto);
  }

  @Patch(':sessionId/status')
  async setStatus(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('sessionId') sessionId: string,
    @Body() dto: SessionStatusDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.counseling.setStatus(schoolId, sessionId, dto);
  }

  @Delete(':sessionId')
  async remove(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('sessionId') sessionId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.counseling.remove(schoolId, sessionId);
  }
}

/**
 * The faculty Counseling Log (PRD 5.14): a teacher's own sessions only. The
 * school always comes from their membership.
 */
@Controller('teacher/counseling')
@UseGuards(SessionGuard)
export class TeacherCounselingController {
  constructor(
    private readonly access: AccessService,
    private readonly counseling: CounselingService,
  ) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Query() query: CounselingQuery) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.counseling.teacherList(scope, query);
  }

  @Post()
  async log(@Auth() auth: AuthContext, @Body() dto: SessionFields) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.counseling.teacherLog(scope, auth.userId, dto);
  }

  @Patch(':sessionId')
  async update(
    @Auth() auth: AuthContext,
    @Id('sessionId') sessionId: string,
    @Body() dto: TeacherSessionDto,
  ) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.counseling.teacherUpdate(scope, sessionId, dto);
  }

  @Delete(':sessionId')
  async remove(@Auth() auth: AuthContext, @Id('sessionId') sessionId: string) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.counseling.teacherRemove(scope, sessionId);
  }
}
