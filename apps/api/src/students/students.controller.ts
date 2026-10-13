import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  GuardianDto,
  StudentDto,
  StudentImportDto,
  StudentListQuery,
} from './students.dto.js';
import { StudentImportService } from './students-import.service.js';
import {
  BLOOD_GROUPS,
  GENDERS,
  GUARDIAN_RELATIONSHIPS,
  STUDENT_STATUSES,
} from './students-options.js';
import { StudentsService } from './students.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

@Controller('students')
@UseGuards(SessionGuard)
export class StudentOptionsController {
  @Get('options')
  options() {
    return {
      genders: GENDERS,
      bloodGroups: BLOOD_GROUPS,
      statuses: STUDENT_STATUSES,
      relationships: GUARDIAN_RELATIONSHIPS,
    };
  }
}

/**
 * The student roster for admins (PRD 4.6). Every route checks the caller is
 * an active admin of :schoolId first, and every query is scoped by it.
 */
@Controller('schools/:schoolId/students')
@UseGuards(SessionGuard)
export class StudentsController {
  constructor(
    private readonly access: AccessService,
    private readonly students: StudentsService,
    private readonly importer: StudentImportService,
  ) {}

  @Get()
  async list(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Query() query: StudentListQuery,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.students.list(schoolId, query);
  }

  @Get('export')
  async export(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Query() query: StudentListQuery,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.students.exportRows(schoolId, query);
  }

  @Post('import')
  @HttpCode(200)
  async import(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: StudentImportDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.importer.import(schoolId, dto);
  }

  @Get(':studentId')
  async get(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('studentId') studentId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.students.get(schoolId, studentId);
  }

  @Post()
  async create(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Body() dto: StudentDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.students.create(schoolId, auth.userId, dto);
  }

  @Patch(':studentId')
  async update(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('studentId') studentId: string,
    @Body() dto: StudentDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.students.update(schoolId, studentId, dto);
  }

  @Delete(':studentId')
  async remove(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('studentId') studentId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.students.remove(schoolId, studentId);
  }

  @Post(':studentId/guardians')
  async addGuardian(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('studentId') studentId: string,
    @Body() dto: GuardianDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.students.addGuardian(schoolId, studentId, dto);
  }

  @Patch(':studentId/guardians/:guardianId')
  async updateGuardian(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('studentId') studentId: string,
    @Id('guardianId') guardianId: string,
    @Body() dto: GuardianDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.students.updateGuardian(schoolId, studentId, guardianId, dto);
  }

  @Delete(':studentId/guardians/:guardianId')
  async removeGuardian(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('studentId') studentId: string,
    @Id('guardianId') guardianId: string,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.students.removeGuardian(schoolId, studentId, guardianId);
  }
}

/**
 * The faculty roster: read-only, and the school and visible students always
 * come from the teacher's own membership and assignments.
 */
@Controller('teacher/students')
@UseGuards(SessionGuard)
export class TeacherStudentsController {
  constructor(
    private readonly access: AccessService,
    private readonly students: StudentsService,
  ) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Query() query: StudentListQuery) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.students.teacherList(scope, query);
  }

  @Get(':studentId')
  async get(@Auth() auth: AuthContext, @Id('studentId') studentId: string) {
    const scope = await this.access.teacherScope(auth.userId);
    return this.students.teacherGet(scope, studentId);
  }
}
