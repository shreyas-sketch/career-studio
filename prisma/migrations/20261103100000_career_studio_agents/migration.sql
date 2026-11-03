-- Career Studio: the agents added to Dossier (docs/PRD.md).

-- CreateEnum
CREATE TYPE "InterviewFocus" AS ENUM ('MIXED', 'BEHAVIORAL', 'TECHNICAL', 'ROLE');

-- CreateEnum
CREATE TYPE "InterviewDifficulty" AS ENUM ('WARMUP', 'STANDARD', 'TOUGH');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "LoopStatus" AS ENUM ('ACTIVE', 'OFFER', 'CLOSED');

-- CreateEnum
CREATE TYPE "RoundKind" AS ENUM ('RECRUITER_SCREEN', 'HIRING_MANAGER', 'TECHNICAL', 'SYSTEM_DESIGN', 'CASE', 'TAKE_HOME', 'BEHAVIORAL', 'PANEL', 'FINAL', 'OTHER');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('UPCOMING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('NEW', 'SAVED', 'PURSUING', 'DISMISSED');

-- CreateEnum
CREATE TYPE "UpworkStatus" AS ENUM ('EVALUATING', 'APPLIED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SkillPlanStatus" AS ENUM ('ACTIVE', 'DONE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "ResumeVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "target" TEXT NOT NULL DEFAULT '',
    "jobDescription" TEXT NOT NULL DEFAULT '',
    "units" JSONB NOT NULL,
    "themeId" TEXT,
    "applicationId" TEXT,
    "writtenWith" TEXT,
    "coach" JSONB,
    "coachedWith" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeVersionSnapshot" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "units" JSONB NOT NULL,
    "cause" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeVersionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewSession" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "jobDescription" TEXT NOT NULL DEFAULT '',
    "focus" "InterviewFocus" NOT NULL DEFAULT 'MIXED',
    "difficulty" "InterviewDifficulty" NOT NULL DEFAULT 'STANDARD',
    "questionTarget" INTEGER NOT NULL DEFAULT 5,
    "interviewer" TEXT NOT NULL DEFAULT '',
    "status" "InterviewStatus" NOT NULL DEFAULT 'ACTIVE',
    "applicationId" TEXT,
    "roundId" TEXT,
    "plan" JSONB,
    "report" JSONB,
    "writtenWith" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'question',
    "competency" TEXT NOT NULL DEFAULT '',
    "question" TEXT NOT NULL,
    "lookingFor" TEXT NOT NULL DEFAULT '',
    "answer" TEXT NOT NULL DEFAULT '',
    "feedback" JSONB,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewLoop" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "jobDescription" TEXT NOT NULL DEFAULT '',
    "applicationId" TEXT,
    "status" "LoopStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewLoop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewRound" (
    "id" TEXT NOT NULL,
    "loopId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "kind" "RoundKind" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL DEFAULT '',
    "interviewer" TEXT NOT NULL DEFAULT '',
    "perspective" TEXT NOT NULL DEFAULT '',
    "scheduledAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "status" "RoundStatus" NOT NULL DEFAULT 'UPCOMING',
    "prep" JSONB,
    "preparedWith" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreelanceOpportunity" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "client" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "budget" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "tags" JSONB NOT NULL,
    "postedAt" TIMESTAMP(3),
    "score" INTEGER,
    "fit" JSONB,
    "scoredWith" TEXT,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreelanceOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpworkAnalysis" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "jobText" TEXT NOT NULL,
    "jobUrl" TEXT NOT NULL DEFAULT '',
    "inputs" JSONB NOT NULL,
    "analysis" JSONB,
    "analyzedWith" TEXT,
    "proposal" TEXT NOT NULL DEFAULT '',
    "proposalWith" TEXT,
    "screening" JSONB,
    "status" "UpworkStatus" NOT NULL DEFAULT 'EVALUATING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpworkAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillPlan" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "targetRole" TEXT NOT NULL DEFAULT '',
    "jobDescription" TEXT NOT NULL DEFAULT '',
    "skill" TEXT NOT NULL DEFAULT '',
    "hoursPerWeek" INTEGER NOT NULL DEFAULT 5,
    "weeks" INTEGER NOT NULL DEFAULT 8,
    "context" TEXT NOT NULL DEFAULT '',
    "applicationId" TEXT,
    "assessment" JSONB,
    "plan" JSONB,
    "writtenWith" TEXT,
    "progress" JSONB NOT NULL,
    "status" "SkillPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResumeVersion_updatedAt_idx" ON "ResumeVersion"("updatedAt");

-- CreateIndex
CREATE INDEX "ResumeVersionSnapshot_versionId_createdAt_idx" ON "ResumeVersionSnapshot"("versionId", "createdAt");

-- CreateIndex
CREATE INDEX "InterviewSession_createdAt_idx" ON "InterviewSession"("createdAt");

-- CreateIndex
CREATE INDEX "InterviewSession_roundId_idx" ON "InterviewSession"("roundId");

-- CreateIndex
CREATE INDEX "InterviewSession_applicationId_idx" ON "InterviewSession"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewTurn_sessionId_index_key" ON "InterviewTurn"("sessionId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewLoop_applicationId_key" ON "InterviewLoop"("applicationId");

-- CreateIndex
CREATE INDEX "InterviewLoop_status_updatedAt_idx" ON "InterviewLoop"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "InterviewRound_loopId_sort_idx" ON "InterviewRound"("loopId", "sort");

-- CreateIndex
CREATE INDEX "InterviewRound_scheduledAt_idx" ON "InterviewRound"("scheduledAt");

-- CreateIndex
CREATE INDEX "FreelanceOpportunity_status_score_idx" ON "FreelanceOpportunity"("status", "score");

-- CreateIndex
CREATE INDEX "FreelanceOpportunity_postedAt_idx" ON "FreelanceOpportunity"("postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FreelanceOpportunity_source_externalId_key" ON "FreelanceOpportunity"("source", "externalId");

-- CreateIndex
CREATE INDEX "UpworkAnalysis_updatedAt_idx" ON "UpworkAnalysis"("updatedAt");

-- CreateIndex
CREATE INDEX "SkillPlan_status_updatedAt_idx" ON "SkillPlan"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeVersionSnapshot" ADD CONSTRAINT "ResumeVersionSnapshot_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ResumeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewSession" ADD CONSTRAINT "InterviewSession_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewSession" ADD CONSTRAINT "InterviewSession_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "InterviewRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewTurn" ADD CONSTRAINT "InterviewTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InterviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewLoop" ADD CONSTRAINT "InterviewLoop_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewRound" ADD CONSTRAINT "InterviewRound_loopId_fkey" FOREIGN KEY ("loopId") REFERENCES "InterviewLoop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillPlan" ADD CONSTRAINT "SkillPlan_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
