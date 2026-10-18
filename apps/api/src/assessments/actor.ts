import { ForbiddenException } from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Who is asking, as the assessment services see it. Admins work on every
 * test and question of their school; a teacher on the tests of their batches
 * and on their own questions (reading the whole bank to build a paper).
 */
export type Actor =
  | { kind: 'ADMIN'; schoolId: string; userId: string }
  | { kind: 'TEACHER'; schoolId: string; userId: string; scope: TeacherScope };

export const isTeacher = (a: Actor): a is Extract<Actor, { kind: 'TEACHER' }> => a.kind === 'TEACHER';

/** A teacher who can still add or change things (an inactive profile can only read); the message says what they can't change. */
export function activeFacultyId(a: Actor, message = 'Only active faculty can change tests and questions'): string | null {
  if (!isTeacher(a)) return null;
  if (!a.scope.active || !a.scope.facultyId) throw new ForbiddenException(message);
  return a.scope.facultyId;
}

/** The name shown as author, as it is now: the admin's, or the teacher's profile name. */
export async function actorName(prisma: PrismaService, a: Actor): Promise<string> {
  if (isTeacher(a) && a.scope.facultyId) {
    const f = await prisma.faculty.findUniqueOrThrow({ where: { id: a.scope.facultyId }, select: { name: true } });
    return f.name;
  }
  const u = await prisma.user.findUniqueOrThrow({ where: { id: a.userId }, select: { fullName: true } });
  return u.fullName;
}
