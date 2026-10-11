-- CreateTable
CREATE TABLE "CurriculumChapter" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "programId" TEXT,
    "subject" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "board" TEXT,
    "classLevel" TEXT,
    "expectedHours" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurriculumChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumConcept" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurriculumConcept_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CurriculumChapter_schoolId_subject_idx" ON "CurriculumChapter"("schoolId", "subject");

-- CreateIndex
CREATE INDEX "CurriculumChapter_programId_idx" ON "CurriculumChapter"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumChapter_schoolId_code_key" ON "CurriculumChapter"("schoolId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumChapter_id_schoolId_key" ON "CurriculumChapter"("id", "schoolId");

-- CreateIndex
CREATE INDEX "CurriculumConcept_chapterId_idx" ON "CurriculumConcept"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumConcept_schoolId_code_key" ON "CurriculumConcept"("schoolId", "code");

-- AddForeignKey
ALTER TABLE "CurriculumChapter" ADD CONSTRAINT "CurriculumChapter_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumChapter" ADD CONSTRAINT "CurriculumChapter_programId_schoolId_fkey" FOREIGN KEY ("programId", "schoolId") REFERENCES "Program"("id", "schoolId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumConcept" ADD CONSTRAINT "CurriculumConcept_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumConcept" ADD CONSTRAINT "CurriculumConcept_chapterId_schoolId_fkey" FOREIGN KEY ("chapterId", "schoolId") REFERENCES "CurriculumChapter"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

