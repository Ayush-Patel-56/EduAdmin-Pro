import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import {
  AdminSlotDto,
  AdminSpecialClassDto,
  ScheduleQuery,
  SPECIAL_CLASS_TYPES,
  TeacherSlotDto,
  TeacherSpecialClassDto,
} from './schedule.dto.js';
import { ScheduleService } from './schedule.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

@Controller('schedule')
@UseGuards(SessionGuard)
export class ScheduleOptionsController {
  @Get('options')
  options() {
    return { specialClassTypes: SPECIAL_CLASS_TYPES };
  }
}

/** Calendar > Class Schedules (PRD 4.1). Every route checks the caller is an admin of :schoolId first. */
@Controller('schools/:schoolId/schedule')
@UseGuards(SessionGuard)
export class AdminScheduleController {
  constructor(
    private readonly access: AccessService,
    private readonly schedule: ScheduleService,
  ) {}

  @Get('faculty')
  async faculty(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.schedule.facultyOptions(schoolId);
  }

  @Get('slots')
  async slots(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: ScheduleQuery) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.schedule.adminSlots(schoolId, query);
  }

  @Post('slots')
  async createSlot(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: AdminSlotDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.schedule.createSlot(schoolId, auth.userId, dto);
  }

  @Patch('slots/:slotId')
  async updateSlot(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('slotId') slotId: string,
    @Body() dto: AdminSlotDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.schedule.updateSlot(schoolId, slotId, dto);
  }

  @Delete('slots/:slotId')
  async deleteSlot(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('slotId') slotId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.schedule.deleteSlot(schoolId, slotId);
  }

  @Get('special-classes')
  async specialClasses(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: ScheduleQuery) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.schedule.adminSpecialClasses(schoolId, query);
  }

  @Post('special-classes')
  async createSpecialClass(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: AdminSpecialClassDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.schedule.createSpecialClass(schoolId, auth.userId, dto);
  }

  @Patch('special-classes/:classId')
  async updateSpecialClass(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('classId') classId: string,
    @Body() dto: AdminSpecialClassDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.schedule.updateSpecialClass(schoolId, classId, dto);
  }

  @Delete('special-classes/:classId')
  async deleteSpecialClass(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('classId') classId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.schedule.deleteSpecialClass(schoolId, classId);
  }
}

/** The faculty Schedule (PRD 5.2): the teacher's own slots and special classes, in their batches. */
@Controller('teacher/schedule')
@UseGuards(SessionGuard)
export class TeacherScheduleController {
  constructor(
    private readonly access: AccessService,
    private readonly schedule: ScheduleService,
  ) {}

  @Get()
  async mine(@Auth() auth: AuthContext) {
    return this.schedule.teacherSchedule(await this.access.teacherScope(auth.userId));
  }

  @Post('slots')
  async createSlot(@Auth() auth: AuthContext, @Body() dto: TeacherSlotDto) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.schedule.teacherCreateSlot(scope, auth.userId, dto);
  }

  @Patch('slots/:slotId')
  async updateSlot(@Auth() auth: AuthContext, @Id('slotId') slotId: string, @Body() dto: TeacherSlotDto) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.schedule.teacherUpdateSlot(scope, slotId, dto);
  }

  @Delete('slots/:slotId')
  async deleteSlot(@Auth() auth: AuthContext, @Id('slotId') slotId: string) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.schedule.teacherDeleteSlot(scope, slotId);
  }

  @Post('special-classes')
  async createSpecialClass(@Auth() auth: AuthContext, @Body() dto: TeacherSpecialClassDto) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.schedule.teacherCreateSpecialClass(scope, auth.userId, dto);
  }

  @Patch('special-classes/:classId')
  async updateSpecialClass(
    @Auth() auth: AuthContext,
    @Id('classId') classId: string,
    @Body() dto: TeacherSpecialClassDto,
  ) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.schedule.teacherUpdateSpecialClass(scope, classId, dto);
  }

  @Delete('special-classes/:classId')
  async deleteSpecialClass(@Auth() auth: AuthContext, @Id('classId') classId: string) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.schedule.teacherDeleteSpecialClass(scope, classId);
  }
}
