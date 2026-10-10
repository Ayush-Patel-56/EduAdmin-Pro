import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from './mail.service.js';
import { normalizeEmail } from './tokens.js';

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;

type Tx = Prisma.TransactionClient;

/** Salted with the user id so the same code for two users hashes differently. */
const hashCode = (userId: string, code: string) =>
  createHash('sha256').update(`${userId}:${code}`).digest('hex');

const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0];

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Replaces any outstanding code for the user. Call inside the signup transaction. */
  async issue(tx: Tx, userId: string): Promise<string> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await tx.emailVerificationToken.deleteMany({ where: { userId } });
    await tx.emailVerificationToken.create({
      data: {
        userId,
        codeHash: hashCode(userId, code),
        expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
      },
    });
    return code;
  }

  async send(to: string, fullName: string, code: string) {
    await this.mail.sendVerificationCode({ to, name: firstName(fullName), code, ttlMinutes: CODE_TTL_MINUTES });
  }

  async verify(rawEmail: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(rawEmail) },
      include: { verificationTokens: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (user?.emailVerified) return; // already done; treat as success
    const token = user?.verificationTokens[0];
    // Same message whether the account or the code is missing, so this can't probe for emails.
    if (!user || !token) throw new BadRequestException('Invalid code. Request a new one.');
    if (token.expiresAt < new Date()) {
      throw new BadRequestException('This code has expired. Request a new one.');
    }
    if (token.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('Too many wrong attempts. Request a new code.');
    }

    if (!sameHash(token.codeHash, hashCode(user.id, code))) {
      const { attempts } = await this.prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 } },
      });
      const left = MAX_ATTEMPTS - attempts;
      throw new BadRequestException(
        left > 0
          ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`
          : 'Too many wrong attempts. Request a new code.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } }),
    ]);
  }

  /** Silent for unknown or already-verified emails, so it can't be used to probe for accounts. */
  async resend(rawEmail: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(rawEmail) },
      include: { verificationTokens: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!user || user.emailVerified) return;

    const last = user.verificationTokens[0];
    if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - last.createdAt.getTime())) / 1000);
      throw new HttpException(`Please wait ${wait}s before requesting another code`, HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = await this.prisma.$transaction((tx) => this.issue(tx, user.id));
    await this.send(user.email, user.fullName, code);
  }
}
