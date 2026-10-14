import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import { CalendarEventDto, EventRangeQuery, UpcomingQuery } from './calendar.dto.js';
import { CalendarService } from './calendar.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

/** Academic Calendar (PRD 4.15): admins only. Every route checks the caller is an admin of :schoolId first. */
@Controller('schools/:schoolId/calendar')
@UseGuards(SessionGuard)
export class CalendarController {
  constructor(
    private readonly access: AccessService,
    private readonly calendar: CalendarService,
  ) {}

  @Get('events')
  async events(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: EventRangeQuery) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.calendar.occurrencesIn(schoolId, query);
  }

  @Get('upcoming')
  async upcoming(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: UpcomingQuery) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.calendar.upcoming(schoolId, query);
  }

  @Post('events')
  async create(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: CalendarEventDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.calendar.create(schoolId, auth.userId, dto);
  }

  @Patch('events/:eventId')
  async update(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('eventId') eventId: string, @Body() dto: CalendarEventDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.calendar.update(schoolId, eventId, dto);
  }

  @Delete('events/:eventId')
  async remove(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('eventId') eventId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.calendar.remove(schoolId, eventId);
  }
}
