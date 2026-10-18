import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import { PtmNoteDto, PtmNoteQuery } from './ptm-notes.dto.js';
import { PtmNotesService } from './ptm-notes.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

/**
 * PTM Notes (PRD 5.8), faculty only: there is no admin route. The school
 * always comes from the teacher's membership, and a teacher only reaches the
 * notes they logged.
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
