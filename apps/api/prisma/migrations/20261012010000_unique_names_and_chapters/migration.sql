-- Case-insensitive uniqueness, enforced by the database and not only by the
-- application, so a double-click or two concurrent imports can't create
-- "Kinematics" and "kinematics" side by side. These are expression indexes,
-- which schema.prisma can't express (Prisma leaves them alone: a replay of all
-- migrations into an empty database diffs clean against the schema).
--
-- Before deploying, make sure no duplicates exist (the index creation fails if
-- they do):
--   SELECT "batchId", "subject", lower("title"), count(*) FROM "SyllabusItem" GROUP BY 1, 2, 3 HAVING count(*) > 1;
--   SELECT "schoolId", lower("name"), count(*) FROM "Program" GROUP BY 1, 2 HAVING count(*) > 1;
--   SELECT "programId", lower("name"), count(*) FROM "Batch" GROUP BY 1, 2 HAVING count(*) > 1;

CREATE UNIQUE INDEX "SyllabusItem_batchId_subject_lower_title_key"
  ON "SyllabusItem" ("batchId", "subject", lower("title"));

CREATE UNIQUE INDEX "Program_schoolId_lower_name_key"
  ON "Program" ("schoolId", lower("name"));

CREATE UNIQUE INDEX "Batch_programId_lower_name_key"
  ON "Batch" ("programId", lower("name"));
