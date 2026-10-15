import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import { DayQuery, OverviewQuery, SheetQuery, SubmitAttendanceDto } from './attendance.dto.js';
import { AttendanceService } from './attendance.service.js';

/** Attendance Overview (PRD 4.11). The caller must be an admin of :schoolId. */
@Controller('schools/:schoolId/attendance')
@UseGuards(SessionGuard)
export class AdminAttendanceController {
  constructor(
    private readonly access: AccessService,
    private readonly attendance: AttendanceService,
  ) {}

  @Get('overview')
  async overview(
    @Auth() auth: AuthContext,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Query() query: OverviewQuery,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.attendance.overview(schoolId, query);
  }
}

/** Attendance Marking (PRD 5.10): the teacher's own classes; the school comes from their membership. */
@Controller('teacher/attendance')
@UseGuards(SessionGuard)
export class TeacherAttendanceController {
  constructor(
    private readonly access: AccessService,
    private readonly attendance: AttendanceService,
  ) {}

  @Get('classes')
  async classes(@Auth() auth: AuthContext, @Query() query: DayQuery) {
    return this.attendance.teacherClasses(await this.access.teacherScope(auth.userId), query);
  }

  @Get('sheet')
  async sheet(@Auth() auth: AuthContext, @Query() query: SheetQuery) {
    return this.attendance.sheet(await this.access.teacherScope(auth.userId), query);
  }

  @Put('sheet')
  async submit(@Auth() auth: AuthContext, @Body() dto: SubmitAttendanceDto) {
    return this.attendance.submit(await this.access.teacherScope(auth.userId), auth.userId, dto);
  }
}
