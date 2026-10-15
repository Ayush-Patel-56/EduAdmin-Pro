import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RUPEES = 10_000_000;

export const FEE_CATEGORIES = ['REGISTRATION', 'MONTHLY_TUITION', 'EXAM', 'MATERIAL', 'OTHER'] as const;
export const FEE_FREQUENCIES = ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export const FEE_STATUSES = ['PAID', 'PENDING', 'PARTIAL', 'OVERDUE', 'WAIVED'] as const;
export const PAYMENT_METHODS = ['UPI', 'CASH', 'CARD', 'NET_BANKING', 'CHEQUE', 'DD'] as const;
export type FeeCategory = (typeof FEE_CATEGORIES)[number];
export type FeeFrequency = (typeof FEE_FREQUENCIES)[number];
export type FeeStatus = (typeof FEE_STATUSES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Rupees with at most two decimals (paise); stored as whole paise. */
const Rupees = (label: string) => [
  Type(() => Number),
  IsNumber({ maxDecimalPlaces: 2 }, { message: `${label} must be an amount in rupees` }),
  Min(0, { message: `${label} can't be negative` }),
  Max(MAX_RUPEES, { message: `${label} is too large` }),
];
const apply = (decorators: PropertyDecorator[]): PropertyDecorator => (target, key) => {
  for (const d of decorators) d(target, key);
};

export class FeeStructureDto {
  @IsIn(FEE_CATEGORIES, { message: 'Select a fee category' })
  category: FeeCategory;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Fee structure name is required' })
  @MaxLength(120)
  name: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @apply(Rupees('Amount'))
  amount: number;

  @IsIn(FEE_FREQUENCIES, { message: 'Select how often it is charged' })
  frequency: FeeFrequency;

  @Type(() => Number)
  @IsInt({ message: 'Due day must be a day of the month (1-31)' })
  @Min(1, { message: 'Due day must be a day of the month (1-31)' })
  @Max(31, { message: 'Due day must be a day of the month (1-31)' })
  dueDay: number;

  @IsBoolean()
  mandatory: boolean;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Select a program' })
  programId?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4', { message: 'Select a batch' })
  batchId?: string | null;

  @Matches(/^\d{4}-\d{2}$/, { message: 'Academic year must look like 2026-27' })
  academicYear: string;
}

export class StructureQuery {
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(FEE_CATEGORIES)
  category?: FeeCategory | null;
}

/** Assess a mandatory fee for every active student it applies to, for the month given. */
export class AssessDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Pick the billing month' })
  month: string;
}

/** A payment as recorded by staff (no money moves through the system). */
export class PaymentFields {
  @apply(Rupees('Amount paid'))
  amountPaid: number;

  @ValidateIf((o: PaymentFields) => o.amountPaid > 0)
  @IsIn(PAYMENT_METHODS, { message: 'Select the payment method' })
  method?: PaymentMethod;

  /** Blank: the next automatic receipt number (REC-2026-000123). */
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/, { message: 'Receipt number can only have letters, digits, - / and _' })
  receiptNumber?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  transactionRef?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @Matches(ISO_DATE, { message: 'Paid date must be a date' })
  paidOn?: string | null;

  /** Sent by the form once per dialog, so a retried submit can't record the payment twice. */
  @Transform(blankToNull)
  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string | null;
}

/** The due's own figures and status; shared by Record Payment and Edit. */
export class DueFields extends PaymentFields {
  @apply(Rupees('Amount due'))
  amountDue: number;

  @apply(Rupees('Discount'))
  discount: number;

  @apply(Rupees('Late fee'))
  lateFee: number;

  @Matches(ISO_DATE, { message: 'Due date is required' })
  dueDate: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(FEE_STATUSES, { message: 'Select a status' })
  statusOverride?: FeeStatus | null;

  // The pipe reports the last-listed check first, so "not empty" goes last.
  @Transform(blankToNull)
  @ValidateIf((o: DueFields) => !!o.statusOverride)
  @MaxLength(300, { message: 'Keep the reason under 300 characters' })
  @IsString({ message: 'Give a reason for overriding the status' })
  @IsNotEmpty({ message: 'Give a reason for overriding the status' })
  overrideReason?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

/** Record Payment Transaction: the student's due for this fee and period (created if new) and a payment on it. */
export class RecordPaymentDto extends DueFields {
  @IsUUID('4', { message: 'Select a student' })
  studentId: string;

  @IsUUID('4', { message: 'Select a fee structure' })
  structureId: string;
}

/** Edit a due: its figures and status, no payment. */
export class AdjustDueDto {
  @apply(Rupees('Amount due'))
  amountDue: number;

  @apply(Rupees('Discount'))
  discount: number;

  @apply(Rupees('Late fee'))
  lateFee: number;

  @Matches(ISO_DATE, { message: 'Due date is required' })
  dueDate: string;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(FEE_STATUSES, { message: 'Select a status' })
  statusOverride?: FeeStatus | null;

  @Transform(blankToNull)
  @ValidateIf((o: AdjustDueDto) => !!o.statusOverride)
  @MaxLength(300, { message: 'Keep the reason under 300 characters' })
  @IsString({ message: 'Give a reason for overriding the status' })
  @IsNotEmpty({ message: 'Give a reason for overriding the status' })
  overrideReason?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class AddPaymentDto extends PaymentFields {}

export class VoidPaymentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Say why the payment is being voided' })
  @MaxLength(300)
  reason: string;
}

export class DueQuery {
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsIn(FEE_STATUSES)
  status?: FeeStatus | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export const MAX_FEE_IMPORT_ROWS = 1000;

export class StructureImportRow {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() @MaxLength(20) amount?: string;
  @IsOptional() @IsString() @MaxLength(20) frequency?: string;
  @IsOptional() @IsString() @MaxLength(5) dueDay?: string;
  @IsOptional() @IsString() @MaxLength(5) mandatory?: string;
  @IsOptional() @IsString() @MaxLength(60) program?: string;
  @IsOptional() @IsString() @MaxLength(60) batch?: string;
  @IsOptional() @IsString() @MaxLength(10) academicYear?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class PaymentImportRow {
  @IsOptional() @IsString() @MaxLength(40) rollNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) studentName?: string;
  @IsOptional() @IsString() @MaxLength(120) structureName?: string;
  @IsOptional() @IsString() @MaxLength(20) amountDue?: string;
  @IsOptional() @IsString() @MaxLength(20) amountPaid?: string;
  @IsOptional() @IsString() @MaxLength(20) discount?: string;
  @IsOptional() @IsString() @MaxLength(20) lateFee?: string;
  @IsOptional() @IsString() @MaxLength(30) method?: string;
  @IsOptional() @IsString() @MaxLength(40) receiptNumber?: string;
  @IsOptional() @IsString() @MaxLength(80) transactionRef?: string;
  @IsOptional() @IsString() @MaxLength(20) dueDate?: string;
  @IsOptional() @IsString() @MaxLength(20) paidOn?: string;
}

export class StructureImportDto {
  @IsArray()
  @ArrayMaxSize(MAX_FEE_IMPORT_ROWS, { message: `Import at most ${MAX_FEE_IMPORT_ROWS} rows at a time` })
  @ValidateNested({ each: true })
  @Type(() => StructureImportRow)
  rows: StructureImportRow[];

  @IsBoolean()
  dryRun: boolean;
}

export class PaymentImportDto {
  @IsArray()
  @ArrayMaxSize(MAX_FEE_IMPORT_ROWS, { message: `Import at most ${MAX_FEE_IMPORT_ROWS} rows at a time` })
  @ValidateNested({ each: true })
  @Type(() => PaymentImportRow)
  rows: PaymentImportRow[];

  @IsBoolean()
  dryRun: boolean;
}
