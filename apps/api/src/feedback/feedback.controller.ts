import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import {
  CreateFeedbackLinkDto,
  FeedbackImportDto,
  FeedbackLinkActiveDto,
  FeedbackQuery,
  FeedbackStatusDto,
  SendFeedbackDto,
  TeacherFeedbackDto,
} from './feedback.dto.js';
import { FeedbackLinksService } from './feedback-links.service.js';
import { FeedbackService } from './feedback.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

/** Feedback Management (PRD 4.12). Every route checks the caller is an admin of :schoolId first. */
@Controller('schools/:schoolId/feedback')
@UseGuards(SessionGuard)
export class AdminFeedbackController {
  constructor(
    private readonly access: AccessService,
    private readonly feedback: FeedbackService,
    private readonly links: FeedbackLinksService,
  ) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: FeedbackQuery) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.feedback.adminList(schoolId, query);
  }

  @Get('recipients')
  async recipients(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.feedback.recipients(schoolId);
  }

  @Post()
  async send(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: SendFeedbackDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.feedback.send(schoolId, auth.userId, dto);
  }

  @Post('import')
  async import(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: FeedbackImportDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.feedback.import(schoolId, auth.userId, dto);
  }

  /** Student feedback links: every batch, with its link if it has one. */
  @Get('links')
  async listLinks(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.links.list(schoolId);
  }

  @Post('links')
  async createLink(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: CreateFeedbackLinkDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.links.create(schoolId, auth.userId, dto.batchId);
  }

  @Patch('links/:batchId')
  async setLinkActive(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('batchId') batchId: string, @Body() dto: FeedbackLinkActiveDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.links.setActive(schoolId, batchId, dto.active);
  }

  @Post('links/:batchId/regenerate')
  async regenerateLink(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('batchId') batchId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.links.regenerate(schoolId, batchId);
  }

  @Patch(':feedbackId/status')
  async setStatus(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('feedbackId') feedbackId: string, @Body() dto: FeedbackStatusDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.feedback.setStatus(schoolId, auth.userId, feedbackId, dto);
  }
}

/** The faculty Feedback page (PRD 5.13). The school always comes from the teacher's membership. */
@Controller('teacher/feedback')
@UseGuards(SessionGuard)
export class TeacherFeedbackController {
  constructor(
    private readonly access: AccessService,
    private readonly feedback: FeedbackService,
  ) {}

  @Get()
  async list(@Auth() auth: AuthContext) {
    return this.feedback.teacherFeedback(await this.access.teacherScope(auth.userId));
  }

  @Post()
  async send(@Auth() auth: AuthContext, @Body() dto: TeacherFeedbackDto) {
    return this.feedback.teacherSend(await this.access.teacherScope(auth.userId), auth.userId, dto);
  }
}
