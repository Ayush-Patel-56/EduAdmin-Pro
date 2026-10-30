import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { durableThrottle } from '../rate-limit/hybrid-throttler.storage.js';
import { Throttle } from '../throttler/index.js';
import { StudentFeedbackDto } from './public-feedback.dto.js';
import { PublicFeedbackService } from './public-feedback.service.js';

/**
 * The student feedback form (no login): the link's token is the only key. A
 * whole class can share one school or carrier IP, so the per-IP limit is loose;
 * the real guard is the per-student 15-minute cool-down.
 */
@Controller('public/feedback')
@Throttle({ default: { limit: 120, ttl: 60_000 }, ...durableThrottle(120, 60_000) })
export class PublicFeedbackController {
  constructor(private readonly feedback: PublicFeedbackService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  form(@Param('token') token: string) {
    return this.feedback.form(token);
  }

  @Post(':token')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  submit(@Param('token') token: string, @Body() dto: StudentFeedbackDto) {
    return this.feedback.submit(token, dto);
  }
}
