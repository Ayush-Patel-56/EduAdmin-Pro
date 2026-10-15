import { downloadFile, toCsv } from '@/lib/spreadsheet'

// Header names accepted for each field (the sample's names first).
export const STUDENT_COLUMNS = {
  fullName: ['Name', 'Full Name', 'Student Name'],
  admissionNumber: ['Admission Number', 'Admission No'],
  aadharNumber: ['Aadhar Number', 'Aadhaar Number', 'Aadhar', 'Aadhaar'],
  rollNumber: ['Roll No', 'Roll Number'],
  email: ['Email'],
  phone: ['Phone', 'Mobile'],
  parentContact: ['Parent Contact', 'Parent Phone'],
  address: ['Address Line 1', 'Address'],
  city: ['City'],
  state: ['State'],
  pincode: ['Pincode', 'PIN'],
  dateOfBirth: ['Date of Birth', 'DOB'],
  gender: ['Gender'],
  bloodGroup: ['Blood Group'],
  profileImageUrl: ['Profile Image URL', 'Photo URL'],
  previousSchool: ['Previous School'],
  previousPercentage: ['Previous Percentage', 'Previous %'],
  classLevel: ['Class', 'Current Class'],
  program: ['Program'],
  batch: ['Batch'],
  admissionDate: ['Admission Date'],
  status: ['Status'],
  notes: ['Notes'],
  guardianName: ['Guardian Name', 'Parent Name'],
  guardianRelationship: ['Guardian Relationship', 'Relationship'],
  guardianPhone: ['Guardian Phone'],
  guardianEmail: ['Guardian Email'],
}

export const STUDENT_HEADER = [
  'Name', 'Admission Number', 'Aadhar Number', 'Roll No', 'Email', 'Phone', 'Parent Contact', 'Address Line 1', 'City', 'State',
  'Pincode', 'Date of Birth (YYYY-MM-DD)', 'Gender', 'Blood Group', 'Profile Image URL', 'Previous School', 'Previous Percentage',
  'Class', 'Program', 'Batch', 'Admission Date (YYYY-MM-DD)', 'Status', 'Notes', 'Guardian Name', 'Guardian Relationship',
  'Guardian Phone', 'Guardian Email',
]

const SAMPLE = [
  STUDENT_HEADER,
  ['Rahul Sharma', 'ADM-101', '2234-5678-9012', '101', 'rahul.sharma@example.com', '9876500001', '9876543210', '12 MG Road', 'Ahmedabad', 'Gujarat', '380001', '2010-04-12', 'Male', 'B+', 'https://example.com/photos/rahul.jpg', 'St. Xavier School', '82%', '9', '', '', '2025-06-01', 'active', 'Scores well in mathematics', 'Suresh Sharma', 'Father', '9876543210', 'suresh.sharma@example.com'],
  ['Priya Patel', 'ADM-102', '3234-5678-9012', '102', 'priya.patel@example.com', '9876500002', '9123456789', '45 Ring Road', 'Surat', 'Gujarat', '395001', '2010-09-03', 'Female', 'O+', '', 'DPS Surat', '91%', '9', '', '', '2025-06-01', 'active', '', 'Meena Patel', 'Mother', '9123456789', 'meena.patel@example.com'],
  ['Amit Verma', '', '', '103', '', '', '', '', '', '', '', '', '', '', '', '', '', '9', '', '', '', 'active', '', '', '', '', ''],
]

export const downloadStudentSample = () => downloadFile('students-sample.csv', toCsv(SAMPLE))
