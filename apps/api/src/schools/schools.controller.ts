import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import { CreateSchoolDto, JoinSchoolDto } from './schools.dto.js';
import { SchoolsService } from './schools.service.js';

@Controller('schools')
@UseGuards(SessionGuard)
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Get('options')
  options() {
    return this.schools.options();
  }

  @Post()
  create(@Auth() auth: AuthContext, @Body() dto: CreateSchoolDto) {
    return this.schools.createSchool(auth, dto);
  }

  @Post('join')
  // Invite codes are guessable only by brute force; keep attempts slow.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  join(@Auth() auth: AuthContext, @Body() dto: JoinSchoolDto) {
    return this.schools.joinSchool(auth, dto.inviteCode);
  }

  @Get(':schoolId/dashboard')
  dashboard(@Auth() auth: AuthContext, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.schools.dashboard(auth, schoolId);
  }
}
