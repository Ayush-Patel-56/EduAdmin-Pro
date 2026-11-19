import { EMAIL_PATTERN, isValidGstin, isValidIndianMobile } from '@/lib/validators'
import type { SchoolFormValues } from './schoolOptions'

export type SchoolErrors = Partial<Record<keyof SchoolFormValues, string>>

/**
 * Every field is required except the MOU end date (blank for an ongoing MOU),
 * the address and the GST number; the API checks the same. Errors come in
 * form order, so the first is the first one on screen.
 */
export function validateSchool(v: SchoolFormValues): SchoolErrors {
  const errors: SchoolErrors = {}
  const name = v.name.trim()
  if (!name) errors.name = 'School name is required'
  else if (name.length < 3) errors.name = 'School name must be at least 3 characters'
  if (!v.board.trim()) errors.board = 'Please select or enter a board'
  if (v.classes.length === 0) errors.classes = 'Select at least one class'
  if (!v.mouStartDate) errors.mouStartDate = 'MOU start date is required'
  else if (v.mouEndDate && v.mouEndDate < v.mouStartDate) errors.mouEndDate = 'End date must be on or after the start date'
  if (v.programs.length === 0) errors.programs = 'Select at least one program'
  if (!v.contactPerson.trim()) errors.contactPerson = 'Contact person is required'
  if (!v.phone.trim()) errors.phone = 'Phone is required'
  else if (!isValidIndianMobile(v.phone)) errors.phone = 'Enter a valid 10-digit mobile number'
  if (!v.email.trim()) errors.email = 'Email is required'
  else if (!EMAIL_PATTERN.test(v.email.trim())) errors.email = 'Enter a valid email address'
  const gst = v.gstNumber.replace(/\s/g, '').toUpperCase()
  if (gst && !isValidGstin(gst)) errors.gstNumber = 'Enter a valid 15-character GST number'
  return errors
}
