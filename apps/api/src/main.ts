import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind a load balancer or reverse proxy, trust exactly that many hops so
  // req.ip (stored on sessions and used by the rate limiter) is the real
  // client, without letting clients spoof X-Forwarded-For.
  const proxyHops = Number(process.env.TRUST_PROXY ?? 0);
  if (proxyHops > 0) app.set('trust proxy', proxyHops);
  // Bulk imports post up to 1,000 spreadsheet rows as JSON (about 300 KB);
  // Nest's default 100 KB limit would answer those with a 413.
  app.useBodyParser('json', { limit: '2mb' });
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      // Surface one readable message instead of class-validator's array.
      exceptionFactory: (errors) => {
        const first = errors.flatMap((e) => Object.values(e.constraints ?? {}))[0];
        return new BadRequestException(first ?? 'Invalid request');
      },
    }),
  );
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });
  // On SIGTERM (deploys), stop accepting requests, let in-flight ones finish
  // and disconnect Prisma via onModuleDestroy.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
