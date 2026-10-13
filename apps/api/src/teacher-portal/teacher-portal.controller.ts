import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import {
  BATCH_ROLES,
  BatchAssignmentDto,
  DESIGNATIONS,
  DesignationDto,
  FacultyDto,
  OwnProfileDto,
  STREAMS,
  SubjectsDto,
} from './faculty-profile.dto.js';
import { FacultyProfileService } from './faculty-profile.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

/** The admin Teacher Portal (PRD 4.7). Every route checks the caller is an admin of :schoolId first. */
@Controller('schools/:schoolId/teacher-portal')
@UseGuards(SessionGuard)
export class TeacherPortalController {
  constructor(
    private readonly access: AccessService,
    private readonly profiles: FacultyProfileService,
  ) {}

  @Get('overview')
  async overview(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.profiles.overview(schoolId);
  }

  @Get('options')
  async options(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return { streams: STREAMS, designations: DESIGNATIONS, batchRoles: BATCH_ROLES };
  }

  @Get('faculty')
  async directory(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.profiles.directory(schoolId);
  }

  @Get('faculty/:facultyId')
  async get(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('facultyId') facultyId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.profiles.get(schoolId, facultyId);
  }

  @Patch('faculty/:facultyId')
  async update(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('facultyId') facultyId: string,
    @Body() dto: FacultyDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.profiles.update(schoolId, auth.userId, facultyId, dto);
  }

  @Put('faculty/:facultyId/subjects')
  async subjects(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('facultyId') facultyId: string,
    @Body() dto: SubjectsDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.profiles.setSubjects(schoolId, facultyId, dto);
  }

  @Put('faculty/:facultyId/designation')
  async designation(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('facultyId') facultyId: string,
    @Body() dto: DesignationDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.profiles.setDesignation(schoolId, facultyId, dto.designation);
  }

  @Post('faculty/:facultyId/batches')
  async assign(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('facultyId') facultyId: string,
    @Body() dto: BatchAssignmentDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.profiles.assignBatch(schoolId, facultyId, dto);
  }

  @Delete('faculty/:facultyId/batches/:batchId')
  async unassign(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('facultyId') facultyId: string,
    @Id('batchId') batchId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.profiles.unassignBatch(schoolId, facultyId, batchId);
  }
}

/** My Profile: a teacher reads their profile and edits only their contact details and photo. */
@Controller('teacher/profile')
@UseGuards(SessionGuard)
export class TeacherProfileController {
  constructor(
    private readonly access: AccessService,
    private readonly profiles: FacultyProfileService,
  ) {}

  private async me(auth: AuthContext) {
    const scope = await this.access.teacherScope(auth.userId);
    if (!scope.facultyId) {
      throw new ForbiddenException('Your faculty profile is not set up in this school');
    }
    return { schoolId: scope.schoolId, facultyId: scope.facultyId };
  }

  @Get()
  async get(@Auth() auth: AuthContext) {
    const { schoolId, facultyId } = await this.me(auth);
    return this.profiles.own(schoolId, facultyId);
  }

  @Patch()
  async update(@Auth() auth: AuthContext, @Body() dto: OwnProfileDto) {
    const { schoolId, facultyId } = await this.me(auth);
    return this.profiles.updateOwn(schoolId, auth.userId, facultyId, dto);
  }
}
