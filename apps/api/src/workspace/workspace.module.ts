import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import {
  AdminWorkspaceController,
  TeacherWorkspaceController,
  WorkspaceOptionsController,
} from './workspace.controller.js';
import { WorkspaceService } from './workspace.service.js';

@Module({
  imports: [AuthModule, AcademicModule, StorageModule],
  controllers: [
    WorkspaceOptionsController,
    TeacherWorkspaceController,
    AdminWorkspaceController,
  ],
  providers: [WorkspaceService],
})
export class WorkspaceModule {}
