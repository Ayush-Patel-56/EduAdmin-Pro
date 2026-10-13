// Fixed choices on the student forms, shared with the web app via
// GET /students/options so the form and the server validation agree.

export const GENDERS = ['Male', 'Female', 'Other'] as const;

export const BLOOD_GROUPS = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
] as const;

export const STUDENT_STATUSES = [
  'ACTIVE',
  'INACTIVE',
  'TRANSFERRED',
  'COMPLETED',
] as const;

export const GUARDIAN_RELATIONSHIPS = [
  'Father',
  'Mother',
  'Guardian',
  'Grandparent',
  'Sibling',
  'Other',
] as const;
