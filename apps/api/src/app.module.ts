import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AcademicModule } from './academic/academic.module.js';
import { AuthModule } from './auth/auth.module.js';
import { validateEnv } from './config/env.js';
import { CurriculumModule } from './curriculum/curriculum.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RecruitmentModule } from './recruitment/recruitment.module.js';
import { SchoolsModule } from './schools/schools.module.js';
import { StorageModule } from './storage/storage.module.js';
import { StudentsModule } from './students/students.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    SchoolsModule,
    AcademicModule,
    CurriculumModule,
    RecruitmentModule,
    StorageModule,
    StudentsModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
