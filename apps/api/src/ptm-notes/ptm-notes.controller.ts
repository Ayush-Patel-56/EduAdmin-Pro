import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import { AdminPtmNoteQuery, PtmNoteDto, PtmNoteQuery } from './ptm-notes.dto.js';
import { PtmNotesService } from './ptm-notes.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

/**
 * PTM Notes (PRD 5.8) for the school's admins: every teacher's notes, read
 * only. Each route checks the caller is an admin of :schoolId first.
 */
@Controller('schools/:schoolId/ptm-notes')
@UseGuards(SessionGuard)
export class AdminPtmNotesController {
  constructor(
    private readonly access: AccessService,
    private readonly notes: PtmNotesService,
  ) {}

  @Get('options')
  async options(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.notes.adminOptions(schoolId);
  }

  @Get()
  async list(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: AdminPtmNoteQuery) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.notes.adminList(schoolId, query);
  }
}

/**
 * PTM Notes (PRD 5.8) for teachers. The school always comes from the
 * teacher's membership, and a teacher only reaches the notes they logged.
 */
@Controller('teacher/ptm-notes')
@UseGuards(SessionGuard)
export class TeacherPtmNotesController {
  constructor(
    private readonly access: AccessService,
    private readonly notes: PtmNotesService,
  ) {}

  @Get('options')
  async options(@Auth() auth: AuthContext) {
    return this.notes.options(await this.access.teacherScope(auth.userId));
  }

  @Get()
  async list(@Auth() auth: AuthContext, @Query() query: PtmNoteQuery) {
    return this.notes.list(await this.access.teacherScope(auth.userId), query);
  }

  @Post()
  async create(@Auth() auth: AuthContext, @Body() dto: PtmNoteDto) {
    return this.notes.create(await this.access.teacherScope(auth.userId), dto);
  }

  @Patch(':noteId')
  async update(@Auth() auth: AuthContext, @Id('noteId') noteId: string, @Body() dto: PtmNoteDto) {
    return this.notes.update(await this.access.teacherScope(auth.userId), noteId, dto);
  }

  @Delete(':noteId')
  async remove(@Auth() auth: AuthContext, @Id('noteId') noteId: string) {
    return this.notes.remove(await this.access.teacherScope(auth.userId), noteId);
  }
}
