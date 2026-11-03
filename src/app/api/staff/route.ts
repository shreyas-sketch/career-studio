import { NextResponse } from "next/server";

import { route } from "@/lib/route";
import { loadStaff } from "@/lib/staff/live";

/** Where the account's staff stands right now, for the live parts of the shell. */
export const GET = route(async () =>
  NextResponse.json(await loadStaff(), { headers: { "cache-control": "no-store" } }),
);
