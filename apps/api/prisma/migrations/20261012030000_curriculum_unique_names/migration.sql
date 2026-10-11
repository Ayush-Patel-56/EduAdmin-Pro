-- Duplicate curriculum names are refused by the database, not only by the
-- application, so a double-click or two concurrent imports can't create the
-- same concept or chapter twice. These are expression indexes, which
-- schema.prisma can't express (Prisma leaves them alone: a replay of all
-- migrations into an empty database diffs clean against the schema).
--
-- Before deploying, make sure no duplicates exist (index creation fails if
-- they do):
--   SELECT "chapterId", lower("name"), count(*) FROM "CurriculumConcept" GROUP BY 1, 2 HAVING count(*) > 1;
--   SELECT "schoolId", "subject", lower("name"), coalesce("board", ''), coalesce("classLevel", ''), coalesce("programId", ''), count(*)
--     FROM "CurriculumChapter" GROUP BY 1, 2, 3, 4, 5, 6 HAVING count(*) > 1;

-- One concept name per chapter (any letter case).
CREATE UNIQUE INDEX "CurriculumConcept_chapterId_lower_name_key"
  ON "CurriculumConcept" ("chapterId", lower("name"));

-- One chapter per subject + name + board + class + program. A blank board,
-- class or program counts as its own value, like the application's check.
CREATE UNIQUE INDEX "CurriculumChapter_natural_key"
  ON "CurriculumChapter" (
    "schoolId", "subject", lower("name"),
    coalesce("board", ''), coalesce("classLevel", ''), coalesce("programId", '')
  );
