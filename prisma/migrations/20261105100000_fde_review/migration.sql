-- FDE Review: reports on another person's public profile against current openings (docs/FDE_REVIEW.md).

-- CreateTable
CREATE TABLE "FdeProfileSnapshot" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "subjectProfileId" TEXT,
    "subjectProfileUrl" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "quality" TEXT NOT NULL,
    "costMicro" INTEGER NOT NULL DEFAULT 0,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FdeProfileSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FdeBenchmark" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "filters" JSONB NOT NULL,
    "roles" JSONB NOT NULL,
    "coverage" JSONB NOT NULL,
    "rubricVersion" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FdeBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FdeReport" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "subjectProfileId" TEXT,
    "subjectProfileUrl" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'running',
    "filters" JSONB NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "stages" JSONB NOT NULL,
    "profileOrigin" TEXT,
    "benchmarkOrigin" TEXT,
    "snapshotId" TEXT,
    "benchmarkId" TEXT,
    "rubricVersion" TEXT NOT NULL DEFAULT '',
    "result" JSONB,
    "freelance" JSONB,
    "learningProgress" JSONB NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "refreshOf" TEXT,
    "pilotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FdeReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FdeUsage" (
    "id" TEXT NOT NULL,
    "reportId" TEXT,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "costMicro" INTEGER NOT NULL DEFAULT 0,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "tokens" INTEGER,
    "callId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FdeUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FdePilot" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "items" JSONB NOT NULL,
    "rejected" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "stopReason" TEXT,
    "concurrency" INTEGER NOT NULL DEFAULT 2,
    "spendLimitMicro" INTEGER NOT NULL,
    "benchmarkId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FdePilot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FdeProfileSnapshot_subjectKey_retrievedAt_idx" ON "FdeProfileSnapshot"("subjectKey", "retrievedAt");

-- CreateIndex
CREATE INDEX "FdeBenchmark_scopeKey_expiresAt_idx" ON "FdeBenchmark"("scopeKey", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "FdeBenchmark_scopeKey_version_key" ON "FdeBenchmark"("scopeKey", "version");

-- CreateIndex
CREATE INDEX "FdeReport_subjectKey_scopeKey_createdAt_idx" ON "FdeReport"("subjectKey", "scopeKey", "createdAt");

-- CreateIndex
CREATE INDEX "FdeReport_createdAt_idx" ON "FdeReport"("createdAt");

-- CreateIndex
CREATE INDEX "FdeReport_pilotId_idx" ON "FdeReport"("pilotId");

-- CreateIndex
CREATE INDEX "FdeUsage_reportId_idx" ON "FdeUsage"("reportId");

-- CreateIndex
CREATE INDEX "FdeUsage_at_idx" ON "FdeUsage"("at");

-- AddForeignKey
ALTER TABLE "FdeReport" ADD CONSTRAINT "FdeReport_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "FdeProfileSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FdeReport" ADD CONSTRAINT "FdeReport_benchmarkId_fkey" FOREIGN KEY ("benchmarkId") REFERENCES "FdeBenchmark"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FdeUsage" ADD CONSTRAINT "FdeUsage_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "FdeReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
