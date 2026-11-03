import { NextResponse } from "next/server";

import { loadCrew } from "@/lib/crew/live";
import { route } from "@/lib/route";

/** Where the account's crew stands right now, for the live parts of the shell. */
export const GET = route(async () =>
  NextResponse.json(await loadCrew(), { headers: { "cache-control": "no-store" } }),
);
