import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { MailService, type Email } from '../auth/mail.service.js';
import { istToday, toIsoDate } from '../common/dates.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Reports listed in one school's section of a digest (the counts cover all of them). */
export const DIGEST_LIST_LIMIT = 15;
/** "Email me now": this many per account per hour (each goes only to the account's own address). */
export const SEND_NOW_PER_HOUR = 3;

type Report = { teacherName: string; batch: { name: string }; subject: string; late: boolean; flaggedAt: Date | null; flagReason: string | null; reportDate: Date };

export type AdminSection = { school: string; submitted: number; late: number; flagged: number; teachers: number; missing: string[]; reports: Report[] };
export type TeacherSection = { school: string; today: Report[]; flagged: Report[]; batches: number };
export type Digest = { day: string; name: string; admin: AdminSection[]; teacher: TeacherSection | null };

const dayLabel = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The daily report digest (Account Preferences: Email Notifications). An
 * admin gets, for each school they run, the day's daily teacher reports:
 * how many came in, late or flagged, and which teachers haven't reported. A
 * teacher gets their own reports for the day and any an admin has flagged.
 * Only for users who keep Email Notifications on and whose address is
 * verified, so school data never goes to an address nobody confirmed.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);
  /** When each account last asked for "email me now" (per API instance; it only ever mails their own address). */
  private readonly sentNow = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** What one user's digest for a day holds; null when there is nothing they oversee or teach. */
  async build(userId: string, day: Date): Promise<Digest | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        fullName: true,
        memberships: { where: { status: 'ACTIVE' }, select: { role: true, school: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
        facultyProfiles: { where: { status: 'ACTIVE' }, select: { id: true, schoolId: true, _count: { select: { batchAssignments: true } } } },
      },
    });
    if (!user) return null;
    const reportSelect = { teacherName: true, batch: { select: { name: true } }, subject: true, late: true, flaggedAt: true, flagReason: true, reportDate: true } as const;
    const admin: AdminSection[] = [];
    for (const m of user.memberships.filter((x) => x.role === 'ADMIN')) {
      const schoolId = m.school.id;
      const [reports, staff] = await Promise.all([
        this.prisma.dailyReport.findMany({ where: { schoolId, reportDate: day }, select: { ...reportSelect, facultyId: true }, orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }] }),
        this.prisma.faculty.findMany({ where: { schoolId, status: 'ACTIVE', batchAssignments: { some: {} } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      ]);
      const reported = new Set(reports.map((r) => r.facultyId));
      admin.push({
        school: m.school.name,
        submitted: reports.length,
        late: reports.filter((r) => r.late).length,
        flagged: reports.filter((r) => r.flaggedAt).length,
        teachers: reported.size,
        missing: staff.filter((f) => !reported.has(f.id)).map((f) => f.name),
        reports: reports.slice(0, DIGEST_LIST_LIMIT),
      });
    }
    let teacher: TeacherSection | null = null;
    const teaching = user.memberships.find((x) => x.role === 'TEACHER');
    const profile = teaching && user.facultyProfiles.find((f) => f.schoolId === teaching.school.id);
    if (teaching && profile && profile._count.batchAssignments > 0) {
      const [today, flagged] = await Promise.all([
        this.prisma.dailyReport.findMany({ where: { schoolId: teaching.school.id, facultyId: profile.id, reportDate: day }, select: reportSelect, orderBy: { submittedAt: 'asc' } }),
        this.prisma.dailyReport.findMany({ where: { schoolId: teaching.school.id, facultyId: profile.id, flaggedAt: { not: null } }, select: reportSelect, orderBy: { reportDate: 'desc' }, take: DIGEST_LIST_LIMIT }),
      ]);
      teacher = { school: teaching.school.name, today, flagged, batches: profile._count.batchAssignments };
    }
    if (!admin.length && !teacher) return null;
    return { day: toIsoDate(day)!, name: user.fullName, admin, teacher };
  }

  /**
   * Sends the day's digests that are due: once per user and day (the
   * EmailDigest row is claimed before sending, so several API instances never
   * send twice; a failed send releases it to be tried again).
   */
  async sendDue(now = new Date()) {
    const day = istToday(now);
    const users = await this.prisma.user.findMany({
      where: { emailNotifications: true, emailVerified: true, memberships: { some: { status: 'ACTIVE' } }, emailDigests: { none: { day } } },
      select: { id: true, email: true },
    });
    let sent = 0;
    for (const u of users) {
      try {
        await this.prisma.emailDigest.create({ data: { userId: u.id, day } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue; // another instance has it
        throw err;
      }
      try {
        const digest = await this.build(u.id, day);
        if (digest) {
          await this.mail.send(compose(u.email, digest));
          sent++;
        }
      } catch (err) {
        this.logger.warn(`Digest for ${u.id} failed: ${(err as Error).message}`);
        await this.prisma.emailDigest.deleteMany({ where: { userId: u.id, day } });
      }
    }
    return sent;
  }

  /** "Email me today's digest now", from Account Preferences: to the user's own (verified) address. */
  async sendNow(userId: string, now = Date.now()) {
    const recent = (this.sentNow.get(userId) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= SEND_NOW_PER_HOUR) throw new HttpException(`You can send yourself the digest ${SEND_NOW_PER_HOUR} times an hour; try again later`, HttpStatus.TOO_MANY_REQUESTS);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerified: true } });
    if (!user.emailVerified) throw new BadRequestException('Verify your email address first: digests go only to a verified address');
    const digest = await this.build(userId, istToday());
    if (!digest) throw new BadRequestException("There's nothing for a digest yet: join a school as an admin, or get assigned to a batch");
    const email = compose(user.email, digest);
    await this.mail.send(email);
    this.sentNow.set(userId, [...recent, now]);
    return { sent: true, to: user.email, subject: email.subject };
  }
}

/** The digest as an email: plain text and simple HTML. */
export function compose(to: string, d: Digest): Email {
  const when = dayLabel(new Date(`${d.day}T00:00:00Z`));
  const line = (r: Report) => `${r.teacherName} · ${r.batch.name} · ${r.subject} · ${r.late ? 'Late' : 'On time'}${r.flaggedAt ? ' · Flagged' : ''}`;
  const text: string[] = [`Hi ${d.name},`, '', `Your daily report digest for ${when}.`];
  const html: string[] = [`<p style="margin:0 0 12px">Hi ${escapeHtml(d.name)},</p><p style="margin:0 0 20px;color:#475569">Your daily report digest for <strong>${escapeHtml(when)}</strong>.</p>`];
  for (const s of d.admin) {
    const summary = `${s.submitted} report${s.submitted === 1 ? '' : 's'} from ${s.teachers} teacher${s.teachers === 1 ? '' : 's'} · ${s.late} late · ${s.flagged} flagged`;
    text.push('', `${s.school}: ${summary}`);
    html.push(`<h2 style="margin:24px 0 6px;font-size:16px;color:#0f172a">${escapeHtml(s.school)}</h2><p style="margin:0 0 10px;color:#334155">${escapeHtml(summary)}</p>`);
    if (s.reports.length) {
      for (const r of s.reports) text.push(`- ${line(r)}`);
      if (s.submitted > s.reports.length) text.push(`- and ${s.submitted - s.reports.length} more`);
      html.push(`<ul style="margin:0 0 10px;padding-left:18px;color:#334155">${s.reports.map((r) => `<li>${escapeHtml(line(r))}</li>`).join('')}${s.submitted > s.reports.length ? `<li>and ${s.submitted - s.reports.length} more</li>` : ''}</ul>`);
    }
    if (s.missing.length) {
      const names = `Not reported yet: ${s.missing.slice(0, 20).join(', ')}${s.missing.length > 20 ? ` and ${s.missing.length - 20} more` : ''}`;
      text.push(names);
      html.push(`<p style="margin:0 0 10px;color:#b45309">${escapeHtml(names)}</p>`);
    }
  }
  if (d.teacher) {
    const t = d.teacher;
    text.push('', `Your reports (${t.school}):`);
    html.push(`<h2 style="margin:24px 0 6px;font-size:16px;color:#0f172a">Your reports · ${escapeHtml(t.school)}</h2>`);
    if (t.today.length) {
      for (const r of t.today) text.push(`- ${line(r)}`);
      html.push(`<ul style="margin:0 0 10px;padding-left:18px;color:#334155">${t.today.map((r) => `<li>${escapeHtml(line(r))}</li>`).join('')}</ul>`);
    } else {
      text.push("You haven't submitted a daily report today.");
      html.push(`<p style="margin:0 0 10px;color:#b45309">You haven't submitted a daily report today.</p>`);
    }
    if (t.flagged.length) {
      text.push('', 'Flagged by an admin:');
      const flags = t.flagged.map((r) => `${toIsoDate(r.reportDate)} · ${r.batch.name} · ${r.subject}${r.flagReason ? `: ${r.flagReason}` : ''}`);
      for (const f of flags) text.push(`- ${f}`);
      html.push(`<p style="margin:0 0 4px;color:#be123c">Flagged by an admin:</p><ul style="margin:0 0 10px;padding-left:18px;color:#334155">${flags.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`);
    }
  }
  text.push('', 'You get this because Email Notifications is on in Account Preferences.');
  html.push(`<p style="margin:28px 0 0;font-size:12px;color:#94a3b8">You get this because Email Notifications is on in Account Preferences.</p>`);
  return {
    to,
    subject: `Daily report digest · ${when}`,
    text: text.join('\n'),
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5"><div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">${html.join('')}</div></body></html>`,
  };
}
