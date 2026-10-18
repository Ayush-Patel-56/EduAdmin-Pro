import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import type { Actor } from './actor.js';
import { PaperDto, QuestionDto, QuestionImportDto, QuestionQuery, ResultsDto, TestDto, TestQuery, TestStatusDto } from './assessments.dto.js';
import { QuestionsService } from './questions.service.js';
import { TestsService } from './tests.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

/** Tests & Question Bank for admins (PRD 4.10). Every route checks the caller is an admin of :schoolId first. */
@Controller('schools/:schoolId/assessments')
@UseGuards(SessionGuard)
export class AdminAssessmentsController {
  constructor(
    private readonly access: AccessService,
    private readonly questions: QuestionsService,
    private readonly tests: TestsService,
  ) {}

  private async actor(auth: AuthContext, schoolId: string): Promise<Actor> {
    await this.access.assertAdmin(auth.userId, schoolId);
    return { kind: 'ADMIN', schoolId, userId: auth.userId };
  }

  @Get('overview')
  async overview(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    await this.actor(auth, schoolId);
    return this.tests.overview(schoolId);
  }

  @Get('options')
  async options(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    return this.tests.options(await this.actor(auth, schoolId));
  }

  @Get('questions')
  async listQuestions(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: QuestionQuery) {
    return this.questions.list(await this.actor(auth, schoolId), query);
  }

  @Post('questions')
  async createQuestion(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: QuestionDto) {
    return this.questions.create(await this.actor(auth, schoolId), dto);
  }

  @Post('questions/import')
  @HttpCode(200)
  async importQuestions(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: QuestionImportDto) {
    return this.questions.import(await this.actor(auth, schoolId), dto);
  }

  @Patch('questions/:questionId')
  async updateQuestion(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('questionId') questionId: string, @Body() dto: QuestionDto) {
    return this.questions.update(await this.actor(auth, schoolId), questionId, dto);
  }

  @Delete('questions/:questionId')
  async removeQuestion(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('questionId') questionId: string) {
    return this.questions.remove(await this.actor(auth, schoolId), questionId);
  }

  @Get('tests')
  async listTests(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: TestQuery) {
    return this.tests.list(await this.actor(auth, schoolId), query);
  }

  @Post('tests')
  async createTest(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: TestDto) {
    return this.tests.create(await this.actor(auth, schoolId), dto);
  }

  @Get('tests/:testId')
  async test(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('testId') testId: string) {
    return this.tests.detail(await this.actor(auth, schoolId), testId);
  }

  @Patch('tests/:testId')
  async updateTest(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('testId') testId: string, @Body() dto: TestDto) {
    return this.tests.update(await this.actor(auth, schoolId), testId, dto);
  }

  @Patch('tests/:testId/status')
  async setTestStatus(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('testId') testId: string, @Body() dto: TestStatusDto) {
    return this.tests.setStatus(await this.actor(auth, schoolId), testId, dto);
  }

  @Delete('tests/:testId')
  async removeTest(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('testId') testId: string) {
    return this.tests.remove(await this.actor(auth, schoolId), testId);
  }

  @Put('tests/:testId/paper')
  async setPaper(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('testId') testId: string, @Body() dto: PaperDto) {
    return this.tests.setPaper(await this.actor(auth, schoolId), testId, dto);
  }

  @Get('tests/:testId/results')
  async results(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('testId') testId: string) {
    return this.tests.results(await this.actor(auth, schoolId), testId);
  }

  @Put('tests/:testId/results')
  async saveResults(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('testId') testId: string, @Body() dto: ResultsDto) {
    return this.tests.saveResults(await this.actor(auth, schoolId), testId, dto);
  }

  @Delete('tests/:testId/results/:studentId')
  async clearResult(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('testId') testId: string, @Id('studentId') studentId: string) {
    return this.tests.clearResult(await this.actor(auth, schoolId), testId, studentId);
  }
}

/**
 * Tests & Question Bank and Academic Records for faculty (PRD 5.11, 5.12).
 * The school comes from the teacher's membership; tests are those of their
 * batches, and the bank they change is their own.
 */
@Controller('teacher/assessments')
@UseGuards(SessionGuard)
export class TeacherAssessmentsController {
  constructor(
    private readonly access: AccessService,
    private readonly questions: QuestionsService,
    private readonly tests: TestsService,
  ) {}

  private async actor(auth: AuthContext): Promise<Actor> {
    const scope = await this.access.teacherScope(auth.userId);
    return { kind: 'TEACHER', schoolId: scope.schoolId, userId: auth.userId, scope };
  }

  @Get('options')
  async options(@Auth() auth: AuthContext) {
    return this.tests.options(await this.actor(auth));
  }

  @Get('questions')
  async listQuestions(@Auth() auth: AuthContext, @Query() query: QuestionQuery) {
    return this.questions.list(await this.actor(auth), query);
  }

  @Post('questions')
  async createQuestion(@Auth() auth: AuthContext, @Body() dto: QuestionDto) {
    return this.questions.create(await this.actor(auth), dto);
  }

  @Post('questions/import')
  @HttpCode(200)
  async importQuestions(@Auth() auth: AuthContext, @Body() dto: QuestionImportDto) {
    return this.questions.import(await this.actor(auth), dto);
  }

  @Patch('questions/:questionId')
  async updateQuestion(@Auth() auth: AuthContext, @Id('questionId') questionId: string, @Body() dto: QuestionDto) {
    return this.questions.update(await this.actor(auth), questionId, dto);
  }

  @Delete('questions/:questionId')
  async removeQuestion(@Auth() auth: AuthContext, @Id('questionId') questionId: string) {
    return this.questions.remove(await this.actor(auth), questionId);
  }

  @Get('tests')
  async listTests(@Auth() auth: AuthContext, @Query() query: TestQuery) {
    return this.tests.list(await this.actor(auth), query);
  }

  @Post('tests')
  async createTest(@Auth() auth: AuthContext, @Body() dto: TestDto) {
    return this.tests.create(await this.actor(auth), dto);
  }

  @Get('tests/:testId')
  async test(@Auth() auth: AuthContext, @Id('testId') testId: string) {
    return this.tests.detail(await this.actor(auth), testId);
  }

  @Patch('tests/:testId')
  async updateTest(@Auth() auth: AuthContext, @Id('testId') testId: string, @Body() dto: TestDto) {
    return this.tests.update(await this.actor(auth), testId, dto);
  }

  @Patch('tests/:testId/status')
  async setTestStatus(@Auth() auth: AuthContext, @Id('testId') testId: string, @Body() dto: TestStatusDto) {
    return this.tests.setStatus(await this.actor(auth), testId, dto);
  }

  @Delete('tests/:testId')
  async removeTest(@Auth() auth: AuthContext, @Id('testId') testId: string) {
    return this.tests.remove(await this.actor(auth), testId);
  }

  @Put('tests/:testId/paper')
  async setPaper(@Auth() auth: AuthContext, @Id('testId') testId: string, @Body() dto: PaperDto) {
    return this.tests.setPaper(await this.actor(auth), testId, dto);
  }

  @Get('tests/:testId/results')
  async results(@Auth() auth: AuthContext, @Id('testId') testId: string) {
    return this.tests.results(await this.actor(auth), testId);
  }

  @Put('tests/:testId/results')
  async saveResults(@Auth() auth: AuthContext, @Id('testId') testId: string, @Body() dto: ResultsDto) {
    return this.tests.saveResults(await this.actor(auth), testId, dto);
  }

  @Delete('tests/:testId/results/:studentId')
  async clearResult(@Auth() auth: AuthContext, @Id('testId') testId: string, @Id('studentId') studentId: string) {
    return this.tests.clearResult(await this.actor(auth), testId, studentId);
  }
}
