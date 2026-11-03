import { Sprout } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AiSetupNotice, EmptyState, relativeDay, Screen, Section } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { applicationOptions, isAiConfigured } from "@/lib/career/shared-data";
import { READINESS_LABELS } from "@/lib/career/skill-plan-data";
import { listSkillPlans } from "@/lib/career/skill-plans";

import { NewPlan } from "./new-plan";

export const metadata: Metadata = { title: "Skill plans" };

/** Agent 7: where you stand for a target, and a plan for one skill sized to your time. */
export default async function SkillsPage({ searchParams }: PageProps<"/skills">) {
  const params = await searchParams;
  const [plans, applications, aiReady] = await Promise.all([listSkillPlans(), applicationOptions(), isAiConfigured()]);
  const text = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");

  return (
    <>
      <PageHeader
        title="Skill plans"
        description="Pick a target role and a skill to build. You get an honest read of your strengths, what transfers and what's missing, then a plan that fits the hours you actually have."
      />
      <Screen wide>
        {!aiReady && <AiSetupNotice what="Skill planning" />}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Section title="New plan">
            <NewPlan applications={applications} disabled={!aiReady} prefill={{ skill: text("skill"), role: text("role"), applicationId: text("application") }} />
          </Section>
          <Section title="Your plans">
            {plans.length === 0 ? (
              <EmptyState icon={<Sprout size={20} aria-hidden="true" />} title="No plans yet">
                A plan names what to learn, what to practise and build, and how to show it, step by step, with hours on each so you can see it fits.
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {plans.map((plan) => (
                  <li key={plan.id}>
                    <Link href={`/skills/${plan.id}`} className="flex flex-col gap-2 rounded-card border border-line-card bg-card p-4 text-ink hover:border-line-strong hover:text-ink">
                      <span className="font-medium text-pretty">{plan.title}</span>
                      <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-track">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${plan.totals.steps ? (plan.totals.done / plan.totals.steps) * 100 : 0}%` }} />
                      </span>
                      <span className="text-meta text-muted">
                        {plan.totals.steps ? `${plan.totals.done} of ${plan.totals.steps} steps` : "Being written"}
                        {plan.readiness ? ` · ${READINESS_LABELS[plan.readiness].split(":")[0]}` : ""} · {plan.status === "ACTIVE" ? relativeDay(plan.updatedAt) : plan.status === "DONE" ? "Done" : "Archived"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </Screen>
    </>
  );
}
