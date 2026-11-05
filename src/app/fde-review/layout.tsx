import type { Metadata } from "next";

import { PublicFrame } from "@/components/public-fde/frame";

// The public FDE Review lives outside the signed-in app's layout, so none of
// its navigation, account menu or data is rendered here.

export const metadata: Metadata = {
  title: { default: "FDE Review", template: "%s · FDE Review" },
  description: "Compare your LinkedIn profile with current forward deployed engineering openings.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default function PublicFdeLayout({ children }: { children: React.ReactNode }) {
  return <PublicFrame>{children}</PublicFrame>;
}
