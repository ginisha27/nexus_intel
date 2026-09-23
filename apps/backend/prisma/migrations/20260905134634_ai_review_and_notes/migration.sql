-- CreateEnum
CREATE TYPE "AssessmentReviewStatus" AS ENUM ('PENDING', 'ACCEPTED', 'MODIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "AiAssessment" ADD COLUMN     "editedExplanation" TEXT,
ADD COLUMN     "editedRecommendedNext" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewStatus" "AssessmentReviewStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT;

-- AlterTable
ALTER TABLE "Investigation" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "notesUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "notesUpdatedBy" TEXT;

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "systemInstruction" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_key_key" ON "PromptTemplate"("key");
