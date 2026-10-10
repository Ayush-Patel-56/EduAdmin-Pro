import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import {
  AdminSignupDto,
  LoginDto,
  ResendVerificationDto,
  SetActiveSchoolDto,
  TeacherSignupDto,
  VerifyEmailDto,
} from './auth.dto.js';
import { AuthService, SESSION_TTL_MS } from './auth.service.js';
import { Auth, type AuthContext, SESSION_COOKIE, SessionGuard } from './session.guard.js';

// Tighter limit on endpoints that check passwords or codes, to slow brute force.
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('signup/teacher')
  @Throttle(STRICT)
  async signupTeacher(@Body() dto: TeacherSignupDto) {
    await this.auth.signupTeacher(dto);
    return { message: 'Account created successfully' };
  }

  @Post('signup/admin')
  @Throttle(STRICT)
  async signupAdmin(@Body() dto: AdminSignupDto) {
    await this.auth.signupAdmin(dto);
    return { message: 'Account created successfully' };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(STRICT)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = await this.auth.login(dto, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
    res.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), maxAge: SESSION_TTL_MS });
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(auth.sessionId);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
    return { ok: true };
  }

  @Post('active-school')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async setActiveSchool(@Auth() auth: AuthContext, @Body() dto: SetActiveSchoolDto) {
    await this.auth.setActiveSchool(auth.userId, auth.sessionId, dto.schoolId);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Auth() auth: AuthContext) {
    return this.auth.profile(auth.userId, auth.activeSchoolId);
  }

  @Post('verify-email')
  @HttpCode(200)
  @Throttle(STRICT)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
    return { message: 'Email verified. You can now log in.' };
  }

  @Post('resend-verification')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.auth.resendVerification(dto.email);
    return { message: 'If that account needs verifying, a new link is on its way.' };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV') === 'production',
      path: '/',
    };
  }
}
