import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import type { Actor } from '../assessments/actor.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import { MarksService } from './marks.service.js';
import { RatingsService } from './ratings.service.js';
import { StudentReportService } from './student-report.service.js';
import {
  MarkSetQuery,
  MarksImportDto,
  OverviewQuery,
  ProgressKeyQuery,
  ProgressListQuery,
  ProgressReportDto,
  RatingDayQuery,
  RatingSheetQuery,
  RatingsDto,
  SetsQuery,
  StudentSearchQuery,
  YearQuery,
} from './student-reports.dto.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

/**
 * Student Reports (PRD 4.5) and Student Progress Reports (PRD 4.8) for
 * admins. Every route checks the caller is an admin of :schoolId first; the
 * services scope every read and write to that school.
 */
@Controller('schools/:schoolId/student-reports')
@UseGuards(SessionGuard)
export class AdminStudentReportsController {
  constructor(
    private readonly access: AccessService,
    private readonly reports: StudentReportService,
    private readonly marks: MarksService,
  ) {}

  private async actor(auth: AuthContext, schoolId: string): Promise<Actor> {
    await this.access.assertAdmin(auth.userId, schoolId);
    return { kind: 'ADMIN', schoolId, userId: auth.userId };
  }

  @Get('options')
  async options(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    return this.marks.options(await this.actor(auth, schoolId));
  }

  @Get('students')
  async search(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: StudentSearchQuery) {
    return this.reports.search(await this.actor(auth, schoolId), query);
  }

  @Get('students/:studentId')
  async report(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('studentId') studentId: string, @Query() query: YearQuery) {
    return this.reports.report(await this.actor(auth, schoolId), studentId, query.year);
  }

  @Get('roster/:batchId')
  async roster(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('batchId') batchId: string) {
    return this.marks.roster(await this.actor(auth, schoolId), batchId);
  }

  @Post('marks/import')
  @HttpCode(200)
  async importMarks(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: MarksImportDto) {
    return this.marks.importMarks(await this.actor(auth, schoolId), dto);
  }

  @Get('marks/sets')
  async sets(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: SetsQuery) {
    return this.marks.sets(await this.actor(auth, schoolId), query);
  }

  @Get('marks/set')
  async set(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: MarkSetQuery) {
    return this.marks.set(await this.actor(auth, schoolId), query);
  }

  @Delete('marks/set')
  async removeSet(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: MarkSetQuery) {
    return this.marks.removeSet(await this.actor(auth, schoolId), query);
  }

  @Get('overview')
  async overview(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: OverviewQuery) {
    return this.marks.overview(await this.actor(auth, schoolId), query);
  }

  @Get('progress-reports')
  async progressList(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: ProgressListQuery) {
    return this.marks.progressList(await this.actor(auth, schoolId), query);
  }

  @Get('progress-reports/one')
  async progressOne(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: ProgressKeyQuery) {
    return this.marks.progressOne(await this.actor(auth, schoolId), query);
  }

  @Put('progress-reports')
  async saveProgress(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: ProgressReportDto) {
    return this.marks.saveProgress(await this.actor(auth, schoolId), dto);
  }

  @Delete('progress-reports')
  async removeProgress(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: ProgressKeyQuery) {
    return this.marks.removeProgress(await this.actor(auth, schoolId), query);
  }
}

/** The same for faculty (PRD 5.4, 5.6): the school always comes from the teacher's membership, and only their batches are in reach. */
@Controller('teacher/student-reports')
@UseGuards(SessionGuard)
export class TeacherStudentReportsController {
  constructor(
    private readonly access: AccessService,
    private readonly reports: StudentReportService,
    private readonly marks: MarksService,
  ) {}

  private async actor(auth: AuthContext): Promise<Actor> {
    const scope = await this.access.teacherScope(auth.userId);
    return { kind: 'TEACHER', schoolId: scope.schoolId, userId: auth.userId, scope };
  }

  @Get('options')
  async options(@Auth() auth: AuthContext) {
    return this.marks.options(await this.actor(auth));
  }

  @Get('students')
  async search(@Auth() auth: AuthContext, @Query() query: StudentSearchQuery) {
    return this.reports.search(await this.actor(auth), query);
  }

  @Get('students/:studentId')
  async report(@Auth() auth: AuthContext, @Id('studentId') studentId: string, @Query() query: YearQuery) {
    return this.reports.report(await this.actor(auth), studentId, query.year);
  }

  @Get('roster/:batchId')
  async roster(@Auth() auth: AuthContext, @Id('batchId') batchId: string) {
    return this.marks.roster(await this.actor(auth), batchId);
  }

  @Post('marks/import')
  @HttpCode(200)
  async importMarks(@Auth() auth: AuthContext, @Body() dto: MarksImportDto) {
    return this.marks.importMarks(await this.actor(auth), dto);
  }

  @Get('marks/sets')
  async sets(@Auth() auth: AuthContext, @Query() query: SetsQuery) {
    return this.marks.sets(await this.actor(auth), query);
  }

  @Get('marks/set')
  async set(@Auth() auth: AuthContext, @Query() query: MarkSetQuery) {
    return this.marks.set(await this.actor(auth), query);
  }

  @Get('overview')
  async overview(@Auth() auth: AuthContext, @Query() query: OverviewQuery) {
    return this.marks.overview(await this.actor(auth), query);
  }

  @Get('progress-reports')
  async progressList(@Auth() auth: AuthContext, @Query() query: ProgressListQuery) {
    return this.marks.progressList(await this.actor(auth), query);
  }

  @Get('progress-reports/one')
  async progressOne(@Auth() auth: AuthContext, @Query() query: ProgressKeyQuery) {
    return this.marks.progressOne(await this.actor(auth), query);
  }

  @Put('progress-reports')
  async saveProgress(@Auth() auth: AuthContext, @Body() dto: ProgressReportDto) {
    return this.marks.saveProgress(await this.actor(auth), dto);
  }

  @Delete('progress-reports')
  async removeProgress(@Auth() auth: AuthContext, @Query() query: ProgressKeyQuery) {
    return this.marks.removeProgress(await this.actor(auth), query);
  }
}

/** Student Ratings (PRD 5.7), faculty only: there is no admin route (admins read ratings in the 5-in-1 report). */
@Controller('teacher/daily-ratings')
@UseGuards(SessionGuard)
export class TeacherRatingsController {
  constructor(
    private readonly access: AccessService,
    private readonly ratings: RatingsService,
  ) {}

  @Get('options')
  async options(@Auth() auth: AuthContext) {
    return this.ratings.options(await this.access.teacherScope(auth.userId));
  }

  @Get()
  async sheet(@Auth() auth: AuthContext, @Query() query: RatingSheetQuery) {
    return this.ratings.sheet(await this.access.teacherScope(auth.userId), query);
  }

  @Put()
  async save(@Auth() auth: AuthContext, @Body() dto: RatingsDto) {
    return this.ratings.save(await this.access.teacherScope(auth.userId), dto);
  }

  @Delete(':studentId')
  async remove(@Auth() auth: AuthContext, @Id('studentId') studentId: string, @Query() query: RatingDayQuery) {
    return this.ratings.remove(await this.access.teacherScope(auth.userId), studentId, query.date);
  }
}
