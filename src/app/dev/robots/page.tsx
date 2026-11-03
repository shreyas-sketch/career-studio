import { notFound } from "next/navigation";

import { Robot, RobotHead, RobotMaterials } from "@/components/staff/robot";
import { verifySession } from "@/lib/auth/session";
import { STAFF_IDS, type StaffMood } from "@/lib/staff/staff";

const GRID = { "2": "grid-cols-2", "3": "grid-cols-3", "7": "grid-cols-7" } as const;
const MOODS: StaffMood[] = ["idle", "working", "waiting", "stuck", "done"];

/** Every robot in every mood, for development only. */
export default async function RobotsPage({ searchParams }: PageProps<"/dev/robots">) {
  if (process.env.NODE_ENV === "production") notFound();
  await verifySession();
  // ?mood=working&cols=2 for a closer look.
  const { mood: only, cols } = await searchParams;
  const moods = MOODS.filter((mood) => !only || mood === only);
  const grid = GRID[cols as keyof typeof GRID] ?? GRID["7"];
  return (
    <main className="signal-wall min-h-screen bg-surface p-6 text-ink">
      <RobotMaterials />
      {moods.map((mood) => (
        <section key={mood} className="mb-4">
          <h2 className="mb-1 text-sm">{mood}</h2>
          <div className={`grid gap-2 ${grid}`}>
            {STAFF_IDS.map((id) => (
              <Robot key={id} id={id} mood={mood} watching className="w-full" />
            ))}
          </div>
        </section>
      ))}
      <div className="flex items-center gap-4 rounded-card bg-white p-3">
        {MOODS.map((mood) => (
          <RobotHead key={mood} id="editor" mood={mood} className="w-10" />
        ))}
      </div>
    </main>
  );
}
