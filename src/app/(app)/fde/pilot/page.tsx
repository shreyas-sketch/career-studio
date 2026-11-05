import type { Metadata } from "next";
import Link from "next/link";

import { Screen, Section } from "@/components/career/parts";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/tenancy/context";

import { NewPilot } from "./new-pilot";

export const metadata: Metadata = { title: "FDE batch pilot" };

export default async function PilotsPage() {
  const pilots = await prisma.fdePilot.findMany({ where: { ownerUserId: requireUserId() }, orderBy: { createdAt: "desc" }, take: 30 });
  return (
    <>
      <PageHeader
        title="Batch pilot"
        before={<Link href="/fde" className="text-sm text-muted underline underline-offset-2 hover:text-ink">FDE review</Link>}
        description="Review many public profiles under a hard spending limit. Nothing runs until you start it: the first batch is 5, and each later batch is your decision."
      />
      <Screen wide>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Section title="New pilot"><NewPilot /></Section>
          <Section title="Your pilots">
            {pilots.length === 0 ? (
              <p className="text-sm text-muted">No pilots yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {pilots.map((pilot) => (
                  <li key={pilot.id}>
                    <Link href={`/fde/pilot/${pilot.id}`} className="block rounded-card border border-line-card bg-card px-4 py-3 hover:bg-hover">
                      <span className="block font-medium">{pilot.name}</span>
                      <span className="text-meta text-muted">{(pilot.items as unknown[]).length} profiles, {pilot.state}</span>
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
