import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import {
  ASSIGNMENT_TYPES,
  AssignmentDto,
  MATERIAL_TYPES,
  MaterialDto,
  SUBMISSION_STATUSES,
  SubmissionDto,
  WORKSPACE_SUBJECTS,
  WorkspaceQuery,
} from './workspace.dto.js';
import { WorkspaceService } from './workspace.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

@Controller('workspace')
@UseGuards(SessionGuard)
export class WorkspaceOptionsController {
  @Get('options')
  options() {
    return {
      subjects: WORKSPACE_SUBJECTS,
      materialTypes: MATERIAL_TYPES,
      assignmentTypes: ASSIGNMENT_TYPES,
      submissionStatuses: SUBMISSION_STATUSES,
    };
  }
}

/**
 * The faculty Academic Workspace (PRD 5.9). The school and the batches a
 * teacher may use always come from their own membership and assignments.
 */
@Controller('teacher/workspace')
@UseGuards(SessionGuard)
export class TeacherWorkspaceController {
  constructor(
    private readonly access: AccessService,
    private readonly workspace: WorkspaceService,
  ) {}

  private scope(auth: AuthContext) {
    return this.access.teacherScope(auth.userId);
  }

  @Get('materials')
  async materials(@Auth() auth: AuthContext, @Query() query: WorkspaceQuery) {
    return this.workspace.teacherMaterials(await this.scope(auth), query);
  }

  @Post('materials')
  async createMaterial(@Auth() auth: AuthContext, @Body() dto: MaterialDto) {
    return this.workspace.createMaterial(await this.scope(auth), auth.userId, dto);
  }

  @Patch('materials/:id')
  async updateMaterial(
    @Auth() auth: AuthContext,
    @Id('id') id: string,
    @Body() dto: MaterialDto,
  ) {
    return this.workspace.updateMaterial(await this.scope(auth), auth.userId, id, dto);
  }

  @Delete('materials/:id')
  async deleteMaterial(@Auth() auth: AuthContext, @Id('id') id: string) {
    return this.workspace.deleteMaterial(await this.scope(auth), id);
  }

  @Get('chapters')
  async chapters(@Auth() auth: AuthContext) {
    return this.workspace.chapters(await this.scope(auth));
  }

  @Get('assignments')
  async assignments(@Auth() auth: AuthContext, @Query() query: WorkspaceQuery) {
    return this.workspace.teacherAssignments(await this.scope(auth), query);
  }

  @Post('assignments')
  async createAssignment(@Auth() auth: AuthContext, @Body() dto: AssignmentDto) {
    return this.workspace.createAssignment(await this.scope(auth), auth.userId, dto);
  }

  @Patch('assignments/:id')
  async updateAssignment(
    @Auth() auth: AuthContext,
    @Id('id') id: string,
    @Body() dto: AssignmentDto,
  ) {
    return this.workspace.updateAssignment(await this.scope(auth), auth.userId, id, dto);
  }

  @Delete('assignments/:id')
  async deleteAssignment(@Auth() auth: AuthContext, @Id('id') id: string) {
    return this.workspace.deleteAssignment(await this.scope(auth), id);
  }

  @Get('assignments/:id/submissions')
  async submissions(@Auth() auth: AuthContext, @Id('id') id: string) {
    return this.workspace.submissions(await this.scope(auth), id);
  }

  @Put('assignments/:id/submissions/:studentId')
  async saveSubmission(
    @Auth() auth: AuthContext,
    @Id('id') id: string,
    @Id('studentId') studentId: string,
    @Body() dto: SubmissionDto,
  ) {
    return this.workspace.saveSubmission(
      await this.scope(auth),
      auth.userId,
      id,
      studentId,
      dto,
    );
  }
}

/** Admins see and preview what faculty uploaded (read-only). */
@Controller('schools/:schoolId/workspace')
@UseGuards(SessionGuard)
export class AdminWorkspaceController {
  constructor(
    private readonly access: AccessService,
    private readonly workspace: WorkspaceService,
  ) {}

  @Get('materials')
  async materials(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Query() query: WorkspaceQuery,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.workspace.adminMaterials(schoolId, query);
  }

  @Get('assignments')
  async assignments(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Query() query: WorkspaceQuery,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.workspace.adminAssignments(schoolId, query);
  }
}
