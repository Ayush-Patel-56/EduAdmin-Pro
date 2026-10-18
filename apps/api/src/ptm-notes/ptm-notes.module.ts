import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TeacherPtmNotesController } from './ptm-notes.controller.js';
import { PtmNotesService } from './ptm-notes.service.js';

@Module({
  imports: [AuthModule, AcademicModule],
  controllers: [TeacherPtmNotesController],
  providers: [PtmNotesService],
})
export class PtmNotesModule {}
