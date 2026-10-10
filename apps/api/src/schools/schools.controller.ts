import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import { CreateJoinCodeDto, CreateSchoolDto } from './schools.dto.js';
import { SchoolsService } from './schools.service.js';

@Controller('schools')
@UseGuards(SessionGuard)
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Post()
  create(@Auth() auth: AuthContext, @Body() dto: CreateSchoolDto) {
    return this.schools.createSchool(auth, dto.name);
  }

  @Get(':schoolId/join-codes')
  listJoinCodes(
    @Auth() auth: AuthContext,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
  ) {
    return this.schools.listJoinCodes(auth, schoolId);
  }

  @Post(':schoolId/join-codes')
  createJoinCode(
    @Auth() auth: AuthContext,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Body() dto: CreateJoinCodeDto,
  ) {
    return this.schools.createJoinCode(auth, schoolId, dto.role);
  }

  @Post(':schoolId/join-codes/:codeId/revoke')
  @HttpCode(200)
  async revokeJoinCode(
    @Auth() auth: AuthContext,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('codeId', ParseUUIDPipe) codeId: string,
  ) {
    await this.schools.revokeJoinCode(auth, schoolId, codeId);
    return { ok: true };
  }
}
