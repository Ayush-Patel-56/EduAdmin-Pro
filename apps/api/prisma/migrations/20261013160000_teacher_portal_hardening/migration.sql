-- Teacher portal hardening (review of #16), in one transaction: an uploaded
-- file belongs to one record. The services already check this before
-- attaching a file; these indexes decide when two requests race past that
-- check (the loser gets a 409).
--
-- Before deploying, make sure none of these return rows (each would make the
-- migration fail and roll back):
--   SELECT "photoFileId", count(*) FROM "Faculty" WHERE "photoFileId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
--   SELECT "fileId", count(*) FROM "StudyMaterial" GROUP BY 1 HAVING count(*) > 1;
--   SELECT "questionFileId", count(*) FROM "Assignment" WHERE "questionFileId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
--   SELECT "fileId", count(*) FROM "AssignmentSubmission" WHERE "fileId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
BEGIN;

CREATE UNIQUE INDEX "Faculty_photoFileId_key" ON "Faculty"("photoFileId");
CREATE UNIQUE INDEX "StudyMaterial_fileId_key" ON "StudyMaterial"("fileId");
CREATE UNIQUE INDEX "Assignment_questionFileId_key" ON "Assignment"("questionFileId");
CREATE UNIQUE INDEX "AssignmentSubmission_fileId_key" ON "AssignmentSubmission"("fileId");

COMMIT;
