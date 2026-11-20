import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSchoolDto } from './schools.dto.js';

const complete = {
  name: 'PST School',
  board: 'State Board',
  classes: ['6th', '7th'],
  academicYearStartMonth: 4,
  mouStartDate: '2026-04-01',
  programs: ['JEE'],
  contactPerson: 'Anita Rao',
  phone: '9876543210',
  email: 'office@pst.edu',
  address: '12 Station Road, Indore',
};
const messages = async (body: object) =>
  (await validate(plainToInstance(CreateSchoolDto, body))).flatMap((e) => Object.values(e.constraints ?? {}));

describe('CreateSchoolDto (create and edit)', () => {
  it('accepts a school without a GST number or an MOU end date', async () => {
    expect(await messages(complete)).toEqual([]);
    expect(await messages({ ...complete, gstNumber: '', mouEndDate: '' })).toEqual([]);
  });

  it('requires the MOU start date, a program, and the contact person, phone, email and address', async () => {
    for (const [field, message] of [
      ['mouStartDate', 'MOU start date is required'],
      ['contactPerson', 'Contact person is required'],
      ['phone', 'Phone is required'],
      ['email', 'Email is required'],
      ['address', 'Address is required'],
    ] as const) {
      expect(await messages({ ...complete, [field]: '   ' })).toContain(message);
      const without: Record<string, unknown> = { ...complete };
      delete without[field];
      expect(await messages(without)).toContain(message);
    }
    expect(await messages({ ...complete, programs: [] })).toContain('Select at least one program');
  });

  it('requires the month the academic year starts in, as the form does', async () => {
    const { academicYearStartMonth: _month, ...withoutMonth } = complete;
    expect(await messages(withoutMonth)).toContain('Academic year start month is required');
    expect(await messages({ ...complete, academicYearStartMonth: null })).toContain('Academic year start month is required');
    expect(await messages({ ...complete, academicYearStartMonth: 13 })).toContain('Academic year start month is invalid');
  });
});
