import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SchoolsController } from './schools.controller.js';
import { SchoolsService } from './schools.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SchoolsController],
  providers: [SchoolsService],
})
export class SchoolsModule {}
