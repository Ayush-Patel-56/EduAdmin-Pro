import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export type VerificationEmail = { to: string; name: string; code: string; ttlMinutes: number };
export type PasswordChangedEmail = { to: string; name: string };
export type Email = { to: string; subject: string; text: string; html: string };

/**
 * Sends email over SMTP (e.g. Gmail with an App Password). When SMTP isn't
 * configured, messages are logged instead so local development still works.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASS');
    const port = Number(config.get<string>('SMTP_PORT', '465'));
    this.from = config.get<string>('MAIL_FROM', user ?? 'no-reply@localhost');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
    } else {
      this.transporter = null;
      if (config.get('NODE_ENV') === 'production') {
        throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASS must be set in production');
      }
      this.logger.warn('SMTP not configured: verification codes will be logged, not emailed');
    }
  }

  /** Any other email (e.g. the daily report digest). Without SMTP, only who it was for and what about is logged. */
  async send({ to, subject, text, html }: Email): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`Email to ${to}: ${subject}`);
      return;
    }
    await this.transporter.sendMail({ from: this.from, to, subject, text, html });
  }

  async sendVerificationCode({ to, name, code, ttlMinutes }: VerificationEmail): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`Verification code for ${to}: ${code}`);
      return;
    }
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: `${code} is your verification code`,
      text:
        `Welcome, ${name}!\n\n` +
        `Your verification code is ${code}. It expires in ${ttlMinutes} minutes.\n\n` +
        `If you didn't create an account, you can safely ignore this email.`,
      html: codeHtml({
        heading: `Welcome, ${name} !`,
        intro: `Enter this code to verify your email address. It expires in <strong style="color:#ffffff">${ttlMinutes} minutes</strong>.`,
        code,
        footer: "If you didn't create an account, you can safely ignore this email.",
      }),
    });
  }

  async sendPasswordResetCode({ to, name, code, ttlMinutes }: VerificationEmail): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`Password reset code for ${to}: ${code}`);
      return;
    }
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: `${code} is your password reset code`,
      text:
        `Hi ${name},\n\n` +
        `Your EduAdmin Pro password reset code is ${code}. It expires in ${ttlMinutes} minutes.\n\n` +
        `If you didn't ask to reset your password, ignore this email: your password stays the same.`,
      html: codeHtml({
        heading: `Hi ${name},`,
        intro: `Enter this code to choose a new password. It expires in <strong style="color:#ffffff">${ttlMinutes} minutes</strong>.`,
        code,
        footer: "If you didn't ask to reset your password, ignore this email: your password stays the same.",
      }),
    });
  }

  /** Tells the account's owner their password changed, so a change they didn't make doesn't go unnoticed. */
  async sendPasswordChanged({ to, name }: PasswordChangedEmail): Promise<void> {
    const text =
      `Hi ${name},\n\n` +
      `The password of your EduAdmin Pro account was just changed, and your other devices were signed out.\n\n` +
      `If this wasn't you, reset your password now with "Forgot password?" on the sign-in page, and tell your school's admin.`;
    await this.send({
      to,
      subject: 'Your EduAdmin Pro password was changed',
      text,
      html: codeHtml({
        heading: `Hi ${name},`,
        intro: 'The password of your EduAdmin Pro account was just changed, and your other devices were signed out.',
        code: null,
        footer: 'If this wasn\'t you, reset your password now with "Forgot password?" on the sign-in page, and tell your school\'s admin.',
      }),
    });
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Table-based layout with inline styles: the only thing email clients reliably render.
// `heading` is escaped here; `intro` and `footer` are fixed copy (with markup) from this file.
function codeHtml({ heading, intro, code, footer }: { heading: string; intro: string; code: string | null; footer: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f3f4f6;font-family:Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#111827;border-radius:16px">
<tr><td style="padding:48px 40px">
  <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#818cf8">${escapeHtml(heading)}</h1>
  <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#d1d5db">
    ${intro}
  </p>
  ${code ? `<div style="display:inline-block;padding:22px 32px;background:#1e1b4b;border:1px solid #6366f1;border-radius:10px;font-size:32px;font-weight:700;letter-spacing:10px;color:#ffffff;font-family:Consolas,Menlo,monospace">${code}</div>` : ''}
  <hr style="margin:32px 0 20px;border:none;border-top:1px solid #1f2937">
  <p style="margin:0;font-size:12px;color:#4b5563">${escapeHtml(footer)}</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
