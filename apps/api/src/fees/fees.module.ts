import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { FeesController } from './fees.controller.js';
import { FeesImportService } from './fees-import.service.js';
import { FeesService } from './fees.service.js';

@Module({
  imports: [AuthModule, AcademicModule],
  controllers: [FeesController],
  providers: [FeesService, FeesImportService],
})
export class FeesModule {}
