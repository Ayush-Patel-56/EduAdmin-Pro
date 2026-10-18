import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import { AdminReportQuery, DailyReportDto, ReportFlagDto } from './daily-reports.dto.js';
import { DailyReportsService } from './daily-reports.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

/** Daily Teacher Reports (PRD 4.8): admins read, flag and delete reports. Every route checks the caller is an admin of :schoolId first. */
@Controller('schools/:schoolId/daily-reports')
@UseGuards(SessionGuard)
export class AdminDailyReportsController {
  constructor(
    private readonly access: AccessService,
    private readonly reports: DailyReportsService,
  ) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: AdminReportQuery) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.reports.adminList(schoolId, query);
  }

  @Patch(':reportId/flag')
  async flag(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('reportId') reportId: string, @Body() dto: ReportFlagDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.reports.setFlag(schoolId, auth.userId, reportId, dto);
  }

  @Delete(':reportId')
  async remove(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('reportId') reportId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.reports.adminRemove(schoolId, reportId);
  }
}

/** The faculty Daily Class Report (PRD 5.6): a teacher's own reports. The school always comes from their membership. */
@Controller('teacher/daily-reports')
@UseGuards(SessionGuard)
export class TeacherDailyReportsController {
  constructor(
    private readonly access: AccessService,
    private readonly reports: DailyReportsService,
  ) {}

  @Get('options')
  async options(@Auth() auth: AuthContext) {
    return this.reports.options(await this.access.teacherScope(auth.userId));
  }

  @Get()
  async list(@Auth() auth: AuthContext) {
    return this.reports.teacherList(await this.access.teacherScope(auth.userId));
  }

  @Post()
  async submit(@Auth() auth: AuthContext, @Body() dto: DailyReportDto) {
    return this.reports.submit(await this.access.teacherScope(auth.userId), dto);
  }

  @Patch(':reportId')
  async update(@Auth() auth: AuthContext, @Id('reportId') reportId: string, @Body() dto: DailyReportDto) {
    return this.reports.update(await this.access.teacherScope(auth.userId), reportId, dto);
  }

  @Delete(':reportId')
  async remove(@Auth() auth: AuthContext, @Id('reportId') reportId: string) {
    return this.reports.remove(await this.access.teacherScope(auth.userId), reportId);
  }
}
