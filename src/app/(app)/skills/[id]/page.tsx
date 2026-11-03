import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Screen } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { isAiConfigured, openJob } from "@/lib/career/shared-data";
import { loadSkillPlan, skillPlanJobKey } from "@/lib/career/skill-plans";

import { PlanView } from "./plan-view";

export const metadata: Metadata = { title: "Skill plan" };

export default async function SkillPlanPage({ params }: PageProps<"/skills/[id]">) {
  const { id } = await params;
  const [plan, aiReady] = await Promise.all([loadSkillPlan(id), isAiConfigured()]);
  if (!plan) notFound();
  const jobId = await openJob(skillPlanJobKey(id));

  return (
    <>
      <PageHeader
        title={plan.title}
        before={
          <Link href="/skills" className="text-sm text-muted hover:text-ink">
            ← Skill plans
          </Link>
        }
        description={`${plan.hoursPerWeek} hours a week for ${plan.weeks} weeks${plan.application ? ` · for your application to ${plan.application.company || plan.application.title}` : ""}`}
      />
      <Screen wide>
        <PlanView
          plan={{ id: plan.id, status: plan.status, assessment: plan.assessment, content: plan.plan, progress: plan.progress, totals: plan.totals, applicationId: plan.application?.id ?? null }}
          jobId={jobId}
          aiReady={aiReady}
        />
      </Screen>
    </>
  );
}
