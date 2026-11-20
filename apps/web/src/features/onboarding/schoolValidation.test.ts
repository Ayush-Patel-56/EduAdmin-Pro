import { describe, expect, it } from 'vitest'
import type { SchoolFormValues } from './schoolOptions'
import { validateSchool } from './schoolValidation'

const complete: SchoolFormValues = {
  name: 'PST School',
  board: 'State Board',
  academicYearStartMonth: 4,
  classes: ['6th', '7th'],
  mouStartDate: '2026-04-01',
  mouEndDate: '',
  programs: ['JEE'],
  contactPerson: 'Anita Rao',
  phone: '9876543210',
  email: 'office@pst.edu',
  address: '12 Station Road, Indore',
  gstNumber: '',
}

describe('validateSchool', () => {
  it('needs every field except the GST number and the MOU end date', () => {
    expect(validateSchool(complete)).toEqual({})
    expect(validateSchool({ ...complete, gstNumber: '', mouEndDate: '' })).toEqual({})
  })

  it('needs the address; spaces alone are not one', () => {
    expect(validateSchool({ ...complete, address: '' })).toEqual({ address: 'Address is required' })
    expect(validateSchool({ ...complete, address: '   ' })).toEqual({ address: 'Address is required' })
  })

  it('names each missing required field, in the order they appear on the form', () => {
    const blank = { ...complete, name: '', board: ' ', classes: [], mouStartDate: '', programs: [], contactPerson: ' ', phone: '', email: '', address: '' }
    const errors = validateSchool(blank)
    expect(Object.keys(errors)).toEqual(['name', 'board', 'classes', 'mouStartDate', 'programs', 'contactPerson', 'phone', 'email', 'address'])
    expect(errors).toMatchObject({
      mouStartDate: 'MOU start date is required',
      programs: 'Select at least one program',
      contactPerson: 'Contact person is required',
      phone: 'Phone is required',
      email: 'Email is required',
      address: 'Address is required',
    })
  })

  it('still checks the format of what was typed, and of an optional GST number', () => {
    expect(validateSchool({ ...complete, phone: '12345', email: 'not-an-email', gstNumber: 'BAD' })).toEqual({
      phone: 'Enter a valid 10-digit mobile number',
      email: 'Enter a valid email address',
      gstNumber: 'Enter a valid 15-character GST number',
    })
    expect(validateSchool({ ...complete, mouEndDate: '2026-03-01' })).toEqual({ mouEndDate: 'End date must be on or after the start date' })
  })
})
