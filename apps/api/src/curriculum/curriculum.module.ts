import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CurriculumController } from './curriculum.controller.js';
import { CurriculumService } from './curriculum.service.js';

@Module({
  imports: [AuthModule, AcademicModule],
  controllers: [CurriculumController],
  providers: [CurriculumService],
})
export class CurriculumModule {}
