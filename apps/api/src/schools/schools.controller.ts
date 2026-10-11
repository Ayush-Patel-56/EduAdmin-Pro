import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import { CreateSchoolDto, JoinSchoolDto, RegenerateCodeDto } from './schools.dto.js';
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

  @Post(':schoolId/regenerate-code')
  @HttpCode(200)
  // Rotating codes is rare; keep it slow so it can't be used to churn them.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  regenerateCode(
    @Auth() auth: AuthContext,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Body() dto: RegenerateCodeDto,
  ) {
    return this.schools.regenerateCode(auth, schoolId, dto.kind);
  }

  @Get(':schoolId/dashboard')
  dashboard(@Auth() auth: AuthContext, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.schools.dashboard(auth, schoolId);
  }
}
