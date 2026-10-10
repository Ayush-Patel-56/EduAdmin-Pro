import { Controller, Get, UseGuards } from '@nestjs/common';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import { SchoolsService } from './schools.service.js';

@Controller('teacher')
@UseGuards(SessionGuard)
export class TeacherController {
  constructor(private readonly schools: SchoolsService) {}

  @Get('dashboard')
  dashboard(@Auth() auth: AuthContext) {
    return this.schools.teacherDashboard(auth);
  }
}
