import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccessService } from '../academic/access.service.js';
import { Auth, type AuthContext, SessionGuard } from '../auth/session.guard.js';
import {
  AddPaymentDto,
  AdjustDueDto,
  AssessDto,
  DueQuery,
  FEE_CATEGORIES,
  FEE_FREQUENCIES,
  FEE_STATUSES,
  FeeStructureDto,
  PAYMENT_METHODS,
  PaymentImportDto,
  RecordPaymentDto,
  StructureImportDto,
  StructureQuery,
  VoidPaymentDto,
} from './fees.dto.js';
import { FeesImportService } from './fees-import.service.js';
import { FeesService } from './fees.service.js';

const Id = (name: string) => Param(name, ParseUUIDPipe);

/**
 * Fee Management (PRD 4.9): admins only, there is no faculty side. Every
 * route checks the caller is an admin of :schoolId before touching data.
 */
@Controller('schools/:schoolId/fees')
@UseGuards(SessionGuard)
export class FeesController {
  constructor(
    private readonly access: AccessService,
    private readonly fees: FeesService,
    private readonly imports: FeesImportService,
  ) {}

  @Get('options')
  async options(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return {
      categories: FEE_CATEGORIES,
      frequencies: FEE_FREQUENCIES,
      statuses: FEE_STATUSES,
      methods: PAYMENT_METHODS,
      ...(await this.fees.options(schoolId)),
    };
  }

  @Get('summary')
  async summary(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.fees.summary(schoolId);
  }

  @Get('structures')
  async structures(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: StructureQuery) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.fees.structures(schoolId, query);
  }

  @Post('structures')
  async createStructure(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: FeeStructureDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.fees.createStructure(schoolId, auth.userId, dto);
  }

  @Post('structures/import')
  @HttpCode(200)
  async importStructures(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: StructureImportDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.imports.structures(schoolId, auth.userId, dto);
  }

  @Patch('structures/:structureId')
  async updateStructure(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('structureId') structureId: string,
    @Body() dto: FeeStructureDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.fees.updateStructure(schoolId, structureId, dto);
  }

  @Delete('structures/:structureId')
  async deleteStructure(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('structureId') structureId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.fees.deleteStructure(schoolId, structureId);
  }

  @Post('structures/:structureId/assess')
  @HttpCode(200)
  async assess(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('structureId') structureId: string,
    @Body() dto: AssessDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.fees.assess(schoolId, auth.userId, structureId, dto);
  }

  @Get('dues')
  async dues(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Query() query: DueQuery) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.fees.dues(schoolId, query);
  }

  @Post('dues')
  async record(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: RecordPaymentDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.fees.record(schoolId, auth.userId, dto);
  }

  @Post('dues/import')
  @HttpCode(200)
  async importPayments(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Body() dto: PaymentImportDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.imports.payments(schoolId, auth.userId, dto);
  }

  @Patch('dues/:dueId')
  async adjust(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('dueId') dueId: string, @Body() dto: AdjustDueDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.fees.adjust(schoolId, auth.userId, dueId, dto);
  }

  @Delete('dues/:dueId')
  async deleteDue(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('dueId') dueId: string) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.fees.deleteDue(schoolId, dueId);
  }

  @Post('dues/:dueId/payments')
  async addPayment(@Auth() auth: AuthContext, @Id('schoolId') schoolId: string, @Id('dueId') dueId: string, @Body() dto: AddPaymentDto) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.fees.addPayment(schoolId, auth.userId, dueId, dto);
  }

  @Post('payments/:paymentId/void')
  @HttpCode(200)
  async voidPayment(
    @Auth() auth: AuthContext,
    @Id('schoolId') schoolId: string,
    @Id('paymentId') paymentId: string,
    @Body() dto: VoidPaymentDto,
  ) {
    await this.access.assertAdmin(auth.userId, schoolId);
    return this.fees.voidPayment(schoolId, auth.userId, paymentId, dto);
  }
}
