import { DataNotice } from "@/components/public-fde/frame";
import { StartForm } from "@/components/public-fde/start";
import { publicFdeConfig } from "@/lib/public-fde/config";
import { marketSummary } from "@/lib/public-fde/summary";
import { intakeState } from "@/lib/public-fde/view";

// The shareable entry: one input, one action. What's below the fold is what a
// visitor gets, stated plainly, and the market line is real or absent.

export default async function PublicFdeLanding({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const deleted = (await searchParams).deleted === "1";
  const [intake, market] = await Promise.all([intakeState().catch(() => ({ open: false, reason: "disabled" as const })), marketSummary().catch(() => null)]);
  return (
    <div className="mx-auto grid w-full max-w-[1240px] grid-cols-[minmax(0,1fr)] gap-12 px-8 pt-16 pb-20 max-sm:px-4 max-sm:pt-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16 lg:pt-24">
      <div className="flex flex-col gap-8">
        <h1 className="max-w-[16ch] font-serif text-[56px] leading-[1.02] font-medium tracking-[-0.025em] text-balance max-md:text-[44px] max-sm:text-[36px]">
          How does your profile read to teams hiring forward deployed engineers?
        </h1>
        <p className="max-w-[56ch] text-lead text-pretty text-muted">
          Paste your LinkedIn URL. We find current FDE openings across employers, compare each one with what your public profile shows, and tell you where you stand, what&apos;s missing and what these roles advertise in pay.
        </p>
        <dl className="grid max-w-[640px] grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-5 sm:grid-cols-3">
          <div className="flex flex-col gap-1 border-t-2 border-ink pt-3">
            <dt className="font-medium">Real openings</dt>
            <dd className="text-sm text-pretty text-muted">Verified open roles at several employers, with links and dates.</dd>
          </div>
          <div className="flex flex-col gap-1 border-t-2 border-ink pt-3">
            <dt className="font-medium">Evidence, not vibes</dt>
            <dd className="text-sm text-pretty text-muted">Every match quotes your profile and the posting. Scores come from a fixed rubric.</dd>
          </div>
          <div className="flex flex-col gap-1 border-t-2 border-ink pt-3">
            <dt className="font-medium">Earning potential</dt>
            <dd className="text-sm text-pretty text-muted">The pay these postings advertise, and the gaps between you and them.</dd>
          </div>
        </dl>
        {market && (
          <p className="max-w-[640px] text-sm text-pretty">
            Today&apos;s sample: {market.roles} verified openings at {market.employers} employers, including {market.names.join(", ")}. Checked {market.checked}.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-4 lg:pt-3">
        {deleted && <p role="status" className="rounded-card border border-line-card bg-card px-4 py-3 text-sm">Your report and its copy of your profile were deleted.</p>}
        <StartForm initialIntake={intake} />
        <DataNotice retentionHours={publicFdeConfig().retentionHours} />
      </div>
    </div>
  );
}
