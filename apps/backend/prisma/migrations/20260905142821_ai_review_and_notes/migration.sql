/*
  Warnings:

  - You are about to drop the column `notes` on the `Investigation` table. All the data in the column will be lost.
  - You are about to drop the column `notesUpdatedAt` on the `Investigation` table. All the data in the column will be lost.
  - You are about to drop the column `notesUpdatedBy` on the `Investigation` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Investigation" DROP COLUMN "notes",
DROP COLUMN "notesUpdatedAt",
DROP COLUMN "notesUpdatedBy";

-- CreateTable
CREATE TABLE "InvestigationNote" (
    "id" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestigationNote_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "InvestigationNote" ADD CONSTRAINT "InvestigationNote_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
