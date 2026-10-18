import { todayIst } from '@/lib/dates'

// The Feedback bulk upload sheet (PRD 4.12): the columns it reads and the template's example rows.

/** Our field names and the header spellings each accepts. */
export const FEEDBACK_COLUMNS = {
  type: ['Type', 'Direction'],
  sender: ['Sender', 'From'],
  rating: ['Rating', 'Stars'],
  content: ['Content', 'Content (Comment)', 'Comment', 'Feedback'],
  subject: ['Subject'],
  target: ['Batch / Target', 'Batch', 'Target', 'To'],
  category: ['Category'],
  date: ['Date'],
}

export const HEADERS = ['Type', 'Sender', 'Rating', 'Content', 'Subject', 'Target', 'Category', 'Date']
/** The format table and the template show the same two examples. */
export const sampleRows = (today = todayIst()) => [
  ['Management -> Teacher', 'Principal Mehta', '5', 'Excellent results in the last unit test.', 'Unit Test 1', 'teacher@school.example', 'Academics', today],
  ['Teacher -> Management', 'teacher@school.example', '5', 'New smartboard in Lab 3 works great.', 'Chemistry Lab', '', 'Administration', today],
]
