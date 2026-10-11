-- CreateEnum
CREATE TYPE "AccentTheme" AS ENUM ('INDIGO', 'BLUE', 'EMERALD', 'SLATE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accentTheme" "AccentTheme",
ADD COLUMN     "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "syllabusUpdates" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "academicYearStartMonth" INTEGER NOT NULL DEFAULT 4;
