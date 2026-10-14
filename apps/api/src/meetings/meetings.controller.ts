import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import { AgendaItemDto, AgendaStateDto, MeetingDto, MeetingQuery } from './meetings.dto.js';
import { MeetingsService } from './meetings.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

/** Meetings (PRD 4.14): admins only. Every route checks the caller is an admin of :schoolId first. */
@Controller('schools/:schoolId/meetings')
@UseGuards(SessionGuard)
export class MeetingsController {
  constructor(
    private readonly access: AccessService,
    private readonly meetings: MeetingsService,
  ) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: MeetingQuery) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.meetings.list(schoolId, query);
  }

  @Get(':meetingId')
  async get(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('meetingId') meetingId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.meetings.get(schoolId, meetingId);
  }

  @Post()
  async create(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: MeetingDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.meetings.create(schoolId, auth.userId, dto);
  }

  @Patch(':meetingId')
  async update(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('meetingId') meetingId: string, @Body() dto: MeetingDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.meetings.update(schoolId, meetingId, dto);
  }

  @Delete(':meetingId')
  async remove(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('meetingId') meetingId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.meetings.remove(schoolId, meetingId);
  }

  @Post(':meetingId/agenda')
  async addAgendaItem(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('meetingId') meetingId: string, @Body() dto: AgendaItemDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.meetings.addAgendaItem(schoolId, meetingId, dto);
  }

  @Patch(':meetingId/agenda/:itemId')
  async updateAgendaItem(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('meetingId') meetingId: string,
    @Id('itemId') itemId: string,
    @Body() dto: AgendaItemDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.meetings.updateAgendaItem(schoolId, meetingId, itemId, dto);
  }

  @Patch(':meetingId/agenda/:itemId/state')
  async setAgendaState(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('meetingId') meetingId: string,
    @Id('itemId') itemId: string,
    @Body() dto: AgendaStateDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.meetings.setAgendaState(schoolId, meetingId, itemId, dto);
  }

  @Delete(':meetingId/agenda/:itemId')
  async removeAgendaItem(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('meetingId') meetingId: string,
    @Id('itemId') itemId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.meetings.removeAgendaItem(schoolId, meetingId, itemId);
  }
}
