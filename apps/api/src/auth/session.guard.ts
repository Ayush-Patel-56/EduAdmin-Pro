import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashToken } from './tokens.js';

export const SESSION_COOKIE = 'eduadmin_sid';

export type AuthContext = {
  sessionId: string;
  userId: string;
  activeSchoolId: string | null;
};

type AuthedRequest = Request & { auth?: AuthContext };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException('Not signed in');
    }

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Your session has expired, please log in again');
    }

    req.auth = {
      sessionId: session.id,
      userId: session.userId,
      activeSchoolId: session.activeSchoolId,
    };
    return true;
  }
}

/** The signed-in user's session; only valid on routes behind SessionGuard. */
export const Auth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
    if (!auth) throw new UnauthorizedException('Not signed in');
    return auth;
  },
);
