import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { FilesController, LocalFilesController } from './files.controller.js';
import { FilesService } from './files.service.js';

@Module({
  imports: [AuthModule, AcademicModule],
  controllers: [FilesController, LocalFilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class StorageModule {}
