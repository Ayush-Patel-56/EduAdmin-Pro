import type { Prisma } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/**
 * Gives a teacher who joins a school a faculty profile there. An imported
 * profile with the same email is claimed (linked to the login) rather than
 * duplicated; rejoining reactivates their old profile.
 */
export async function linkFacultyProfile(
  tx: Tx,
  schoolId: string,
  user: {
    id: string;
    email: string;
    fullName: string;
    department?: string | null;
  },
) {
  const existing = await tx.faculty.findUnique({
    where: { schoolId_userId: { schoolId, userId: user.id } },
    select: { id: true },
  });
  if (existing) {
    await tx.faculty.update({
      where: { id: existing.id },
      data: { status: 'ACTIVE' },
    });
    return;
  }
  const imported = await tx.faculty.findUnique({
    where: { schoolId_email: { schoolId, email: user.email } },
    select: { id: true, userId: true },
  });
  if (imported && !imported.userId) {
    await tx.faculty.update({
      where: { id: imported.id },
      data: { userId: user.id, status: 'ACTIVE' },
    });
    return;
  }
  await tx.faculty.create({
    data: {
      schoolId,
      userId: user.id,
      name: user.fullName,
      // Another profile already uses this email (linked to someone else); keep
      // this one without an email rather than failing the join.
      email: imported ? null : user.email,
      subjects: user.department ? [user.department] : [],
    },
  });
}

/** A teacher who switched schools keeps their profile in the old one, marked inactive. */
export async function deactivateFacultyProfiles(
  tx: Tx,
  userId: string,
  exceptSchoolId: string,
) {
  await tx.faculty.updateMany({
    where: { userId, schoolId: { not: exceptSchoolId } },
    data: { status: 'INACTIVE' },
  });
}
