import { STAFF_IDS } from "@/lib/staff/staff";

import { Robot, RobotMaterials } from "./robot";

/** The right half of the sign-in screens: the staff, waiting, and what Career Studio is. */
export function SignInWall() {
  return (
    <div className="signal-wall relative hidden flex-col justify-center gap-10 overflow-hidden bg-surface p-14 text-ink min-[960px]:flex">
      <RobotMaterials />
      <ul aria-hidden="true" className="grid w-full grid-cols-7 gap-1">
        {STAFF_IDS.map((id) => (
          <li key={id}>
            <Robot id={id} watching className="w-full" />
          </li>
        ))}
      </ul>
      <div className="mx-auto flex max-w-[520px] flex-col gap-3 text-center">
        <p className="font-display text-[34px] leading-[1.12] font-medium tracking-[-0.026em] text-pretty">A staff of seven for your next move.</p>
        <p className="text-lead text-pretty text-muted">Search, resumes, interview preparation, freelance work and skills, each handled by a specialist working from your own record. Nothing goes out without you.</p>
      </div>
    </div>
  );
}
