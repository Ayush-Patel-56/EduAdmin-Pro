import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { FilesService } from '../storage/files.service.js';
import type { AssignmentDto, MaterialDto } from './workspace.dto.js';
import { WorkspaceService } from './workspace.service.js';

const scope = (over: Partial<TeacherScope> = {}): TeacherScope => ({
  schoolId: 'school-1',
  facultyId: 'fac-1',
  batchIds: ['b-mine'],
  programIds: ['p1'],
  active: true,
  ...over,
});
const material = (over: Partial<MaterialDto> = {}) =>
  ({ title: 'Notes', provider: 'Faculty', batchId: 'b-mine', subject: 'Physics', type: 'NOTES', isPublic: true, fileId: 'file-1', ...over }) as MaterialDto;
const assignment = (over: Partial<AssignmentDto> = {}) =>
  ({ title: 'DPP 1', chapter: 'Kinematics', batchId: 'b-mine', subject: 'Physics', type: 'DPP', dueDate: '2026-10-20', dueTime: '23:59', totalMarks: 50, ...over }) as AssignmentDto;

function build() {
  const prisma = {
    studyMaterial: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'm1' }), update: vi.fn(), delete: vi.fn() },
    assignment: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'a1' }), update: vi.fn(), delete: vi.fn() },
    assignmentSubmission: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _max: { score: null } }) },
    student: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), groupBy: vi.fn().mockResolvedValue([]) },
    fileObject: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const files = { claim: vi.fn(), discard: vi.fn(), url: vi.fn() };
  const service = new WorkspaceService(prisma as unknown as PrismaService, files as unknown as FilesService);
  return { prisma, files, service };
}

describe('WorkspaceService: study material', () => {
  it('a teacher only uploads to their own batches, and only while active', async () => {
    const { service, prisma } = build();
    await expect(service.createMaterial(scope(), 'u', material({ batchId: 'b-other' }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createMaterial(scope({ active: false }), 'u', material())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.studyMaterial.create).not.toHaveBeenCalled();
  });

  it('the file must be a fresh STUDY_MATERIAL upload by this user', async () => {
    const { service, files } = build();
    await service.createMaterial(scope(), 'user-1', material());
    expect(files.claim).toHaveBeenCalledWith('school-1', 'file-1', 'STUDY_MATERIAL', 'user-1');
  });

  it('private material is listed only for its uploader', async () => {
    const { service, prisma } = build();
    await service.teacherMaterials(scope(), {});
    expect(prisma.studyMaterial.findMany.mock.calls[0][0].where).toMatchObject({
      schoolId: 'school-1',
      batchId: { in: ['b-mine'] },
      OR: [{ isPublic: true }, { facultyId: 'fac-1' }],
    });
    // No faculty profile: public only (never "facultyId: undefined", which would match everything).
    await service.teacherMaterials(scope({ facultyId: null }), {});
    expect(prisma.studyMaterial.findMany.mock.calls[1][0].where.OR).toEqual([{ isPublic: true }]);
  });

  it("filtering by someone else's batch is refused; an inactive teacher sees nothing", async () => {
    const { service, prisma } = build();
    await expect(service.teacherMaterials(scope(), { batchId: 'b-other' })).rejects.toBeInstanceOf(ForbiddenException);
    await service.teacherMaterials(scope({ active: false }), {});
    expect(prisma.studyMaterial.findMany.mock.calls[0][0].where.batchId).toEqual({ in: [] });
  });

  it("only the uploader can edit or delete; another school's id is a 404", async () => {
    const { service, prisma } = build();
    prisma.studyMaterial.findFirst.mockResolvedValue({ facultyId: 'fac-2', fileId: 'f', file: { id: 'f', key: 'k' } });
    await expect(service.deleteMaterial(scope(), 'm1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateMaterial(scope(), 'u', 'm1', material())).rejects.toBeInstanceOf(ForbiddenException);
    prisma.studyMaterial.findFirst.mockResolvedValue(null);
    await expect(service.deleteMaterial(scope(), 'foreign')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.studyMaterial.findFirst.mock.calls[2][0].where).toEqual({ id: 'foreign', schoolId: 'school-1' });
    expect(prisma.studyMaterial.delete).not.toHaveBeenCalled();
  });

  it('replacing the file deletes the old one', async () => {
    const { service, prisma, files } = build();
    prisma.studyMaterial.findFirst.mockResolvedValue({ facultyId: 'fac-1', fileId: 'old', file: { id: 'old', key: 'k-old' } });
    await service.updateMaterial(scope(), 'u', 'm1', material({ fileId: 'new' }));
    expect(files.claim).toHaveBeenCalledWith('school-1', 'new', 'STUDY_MATERIAL', 'u', 'old');
    expect(files.discard).toHaveBeenCalledWith([{ id: 'old', key: 'k-old' }]);
  });
});

describe('WorkspaceService: assignments and grading', () => {
  it('the due date and time are read as Indian time', async () => {
    const { service, prisma } = build();
    await service.createAssignment(scope(), 'u', assignment({ dueDate: '2026-10-20', dueTime: '23:59' }));
    expect(prisma.assignment.create.mock.calls[0][0].data.dueAt.toISOString()).toBe('2026-10-20T18:29:00.000Z');
  });

  const visible = { id: 'a1', batchId: 'b-mine', totalMarks: 50, title: 'DPP', dueAt: new Date(), batch: { name: 'Batch A' } };

  it('grading: score above total, or Graded without a score, is refused', async () => {
    const { service, prisma } = build();
    prisma.assignment.findFirst.mockResolvedValue(visible);
    prisma.student.findFirst.mockResolvedValue({ id: 'st-1' });
    await expect(service.saveSubmission(scope(), 'u', 'a1', 'st-1', { status: 'SUBMITTED', score: 51 })).rejects.toThrow('at most 50');
    await expect(service.saveSubmission(scope(), 'u', 'a1', 'st-1', { status: 'GRADED' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.assignmentSubmission.upsert).not.toHaveBeenCalled();
  });

  it('a score marks the work graded, by this teacher', async () => {
    const { service, prisma } = build();
    prisma.assignment.findFirst.mockResolvedValue(visible);
    prisma.student.findFirst.mockResolvedValue({ id: 'st-1' });
    await expect(service.saveSubmission(scope(), 'teacher-user', 'a1', 'st-1', { status: 'SUBMITTED', score: 42.5, feedback: 'Good' })).resolves.toEqual({ status: 'GRADED', score: 42.5 });
    expect(prisma.assignmentSubmission.upsert.mock.calls[0][0].update).toMatchObject({ status: 'GRADED', score: 42.5, gradedById: 'teacher-user' });
  });

  it("a student outside the assignment's batch can't be graded; another teacher's batch is a 404", async () => {
    const { service, prisma } = build();
    prisma.assignment.findFirst.mockResolvedValue(visible);
    prisma.student.findFirst.mockResolvedValue(null);
    await expect(service.saveSubmission(scope(), 'u', 'a1', 'st-x', { status: 'SUBMITTED' })).rejects.toBeInstanceOf(NotFoundException);
    prisma.assignment.findFirst.mockResolvedValue(null);
    await expect(service.submissions(scope(), 'a-other')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.assignment.findFirst.mock.calls[1][0].where).toMatchObject({ id: 'a-other', schoolId: 'school-1', batchId: { in: ['b-mine'] } });
  });

  it("total marks can't drop below a score already given, and a graded assignment keeps its batch", async () => {
    const { service, prisma } = build();
    prisma.assignment.findFirst.mockResolvedValue({ facultyId: 'fac-1', batchId: 'b-mine', questionFileId: null, questionFile: null, _count: { submissions: 3 } });
    prisma.assignmentSubmission.aggregate.mockResolvedValue({ _max: { score: 45 } });
    await expect(service.updateAssignment(scope(), 'u', 'a1', assignment({ totalMarks: 40 }))).rejects.toThrow('scored 45');
    await expect(service.updateAssignment(scope({ batchIds: ['b-mine', 'b-two'] }), 'u', 'a1', assignment({ batchId: 'b-two' }))).rejects.toThrow('stays with its batch');
    expect(prisma.assignment.update).not.toHaveBeenCalled();
  });

  it('the submission rate counts handed-in work over active students of the batch', async () => {
    const { service, prisma, files } = build();
    files.url.mockResolvedValue(null);
    prisma.assignment.findMany.mockResolvedValue([
      { id: 'a1', batchId: 'b-mine', title: 'DPP', description: null, chapter: 'C', subject: 'Physics', type: 'DPP', dueAt: new Date('2026-10-20T18:29:00Z'), totalMarks: 50, facultyId: 'fac-1', questionFileId: null, questionFile: null, batch: { id: 'b-mine', name: 'A' }, faculty: { id: 'fac-1', name: 'T' }, submissions: [{ status: 'SUBMITTED' }, { status: 'GRADED' }, { status: 'PENDING' }] },
    ]);
    prisma.student.groupBy.mockResolvedValue([{ batchId: 'b-mine', _count: { _all: 4 } }]);
    const [row] = await service.teacherAssignments(scope(), {});
    expect(row).toMatchObject({ students: 4, handedIn: 2, graded: 1, mine: true, dueDate: '2026-10-20', dueTime: '23:59' });
  });
});
