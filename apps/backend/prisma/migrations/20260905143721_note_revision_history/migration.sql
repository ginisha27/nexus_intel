-- CreateTable
CREATE TABLE "InvestigationNoteRevision" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "versionAt" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestigationNoteRevision_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "InvestigationNoteRevision" ADD CONSTRAINT "InvestigationNoteRevision_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "InvestigationNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
