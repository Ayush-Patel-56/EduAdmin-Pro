import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import {
  AppraisalDto,
  CandidateDto,
  CandidateStageDto,
  InterviewDto,
  JobRequirementDto,
} from './recruitment.dto.js';
import {
  APPRAISAL_BADGES,
  APPRAISAL_PERIODS,
  APPRAISAL_STATUSES,
  CANDIDATE_STAGES,
  DEPARTMENTS,
  INTERVIEW_MODES,
  INTERVIEW_RESULTS,
  JOB_STATUSES,
  PIPELINE_STAGES,
} from './recruitment-options.js';
import { type ListFilters, RecruitmentService } from './recruitment.service.js';

const Id = () => Param('id', ParseUUIDPipe);

/** Validates list query params; anything unknown is rejected rather than ignored. */
function filters(query: Record<string, unknown>): ListFilters {
  const str = (k: string) =>
    typeof query[k] === 'string' && query[k]
      ? (query[k] as string).trim()
      : undefined;
  const schoolId = str('schoolId');
  if (schoolId && !/^[0-9a-f-]{36}$/i.test(schoolId))
    throw new BadRequestException('Invalid school');
  const department = str('department');
  if (department && !(DEPARTMENTS as readonly string[]).includes(department))
    throw new BadRequestException('Unknown department');
  const stage = str('stage');
  if (stage && !(CANDIDATE_STAGES as readonly string[]).includes(stage))
    throw new BadRequestException('Unknown stage');
  const q = str('q')?.slice(0, 100);
  return { schoolId, department, stage, q };
}

/**
 * Recruitment & staff appraisals for admins. Every handler resolves the
 * caller's admin schools first (RecruitmentService.scope), and every write is
 * audited with the caller's name, IP and user agent.
 */
@Controller('recruitment')
@UseGuards(SessionGuard)
export class RecruitmentController {
  constructor(private readonly recruitment: RecruitmentService) {}

  private actor(auth: AuthContext, req: Request) {
    return this.recruitment.actor(auth.userId, req.ip, req.get('user-agent'));
  }

  @Get('options')
  async options(@Auth() auth: AuthContext) {
    await this.recruitment.scope(auth.userId);
    return {
      departments: DEPARTMENTS,
      jobStatuses: JOB_STATUSES,
      pipelineStages: PIPELINE_STAGES,
      candidateStages: CANDIDATE_STAGES,
      interviewModes: INTERVIEW_MODES,
      interviewResults: INTERVIEW_RESULTS,
      appraisalPeriods: APPRAISAL_PERIODS,
      appraisalStatuses: APPRAISAL_STATUSES,
      appraisalBadges: APPRAISAL_BADGES,
    };
  }

  @Get('overview')
  overview(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>) {
    return this.recruitment.overview(auth.userId, filters(query).schoolId);
  }

  // Job requirements

  @Get('requirements')
  requirements(
    @Auth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ) {
    return this.recruitment.listRequirements(auth.userId, filters(query));
  }

  @Post('requirements')
  async createRequirement(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Body() dto: JobRequirementDto,
  ) {
    return this.recruitment.createRequirement(await this.actor(auth, req), dto);
  }

  @Patch('requirements/:id')
  async updateRequirement(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Id() id: string,
    @Body() dto: JobRequirementDto,
  ) {
    return this.recruitment.updateRequirement(
      await this.actor(auth, req),
      id,
      dto,
    );
  }

  @Delete('requirements/:id')
  async deleteRequirement(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Id() id: string,
  ) {
    return this.recruitment.deleteRequirement(await this.actor(auth, req), id);
  }

  // Candidates

  @Get('candidates')
  candidates(
    @Auth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ) {
    return this.recruitment.listCandidates(auth.userId, filters(query));
  }

  @Post('candidates')
  async createCandidate(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Body() dto: CandidateDto,
  ) {
    return this.recruitment.createCandidate(await this.actor(auth, req), dto);
  }

  @Patch('candidates/:id')
  async updateCandidate(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Id() id: string,
    @Body() dto: CandidateDto,
  ) {
    return this.recruitment.updateCandidate(
      await this.actor(auth, req),
      id,
      dto,
    );
  }

  @Patch('candidates/:id/stage')
  async setStage(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Id() id: string,
    @Body() dto: CandidateStageDto,
  ) {
    return this.recruitment.setStage(
      await this.actor(auth, req),
      id,
      dto.stage,
    );
  }

  @Delete('candidates/:id')
  async deleteCandidate(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Id() id: string,
  ) {
    return this.recruitment.deleteCandidate(await this.actor(auth, req), id);
  }

  // Interviews

  @Get('interviews')
  interviews(
    @Auth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ) {
    return this.recruitment.listInterviews(auth.userId, filters(query));
  }

  @Post('interviews')
  async createInterview(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Body() dto: InterviewDto,
  ) {
    return this.recruitment.createInterview(await this.actor(auth, req), dto);
  }

  @Patch('interviews/:id')
  async updateInterview(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Id() id: string,
    @Body() dto: InterviewDto,
  ) {
    return this.recruitment.updateInterview(
      await this.actor(auth, req),
      id,
      dto,
    );
  }

  @Delete('interviews/:id')
  async deleteInterview(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Id() id: string,
  ) {
    return this.recruitment.deleteInterview(await this.actor(auth, req), id);
  }

  // Appraisals

  @Get('appraisals')
  appraisals(
    @Auth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ) {
    return this.recruitment.listAppraisals(auth.userId, filters(query));
  }

  @Post('appraisals')
  async createAppraisal(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Body() dto: AppraisalDto,
  ) {
    return this.recruitment.createAppraisal(await this.actor(auth, req), dto);
  }

  @Patch('appraisals/:id')
  async updateAppraisal(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Id() id: string,
    @Body() dto: AppraisalDto,
  ) {
    return this.recruitment.updateAppraisal(
      await this.actor(auth, req),
      id,
      dto,
    );
  }

  @Delete('appraisals/:id')
  async deleteAppraisal(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Id() id: string,
  ) {
    return this.recruitment.deleteAppraisal(await this.actor(auth, req), id);
  }

  // Audit trail: read-only by design (no write routes exist).

  @Get('audit')
  audit(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>) {
    return this.recruitment.auditLog(auth.userId, filters(query).schoolId);
  }
}
