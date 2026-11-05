import { NextResponse } from "next/server";

import { fetchProfileImage, fixtureImage } from "@/lib/fde/media";
import { normalizedProfileSchema } from "@/lib/fde/types";
import { prisma } from "@/lib/prisma";
import { ownerOf } from "@/lib/public-fde/guest";
import { currentGuest, PUBLIC_HEADERS, publicRoute } from "@/lib/public-fde/http";

// A picture from the visitor's own profile read, by its key. The address is
// never taken from the request, so this can't fetch anything else, and an
// expired or blocked image is a 404 the page answers with its fallback.

type Context = { params: Promise<{ id: string; key: string }> };

const notFound = () => new NextResponse(null, { status: 404, headers: PUBLIC_HEADERS });

export const GET = publicRoute<Context>(async (_request, { params }) => {
  const guestId = await currentGuest();
  const { id, key } = await params;
  if (!guestId) return notFound();
  const report = await prisma.fdeReport.findUnique({ where: { id }, include: { snapshot: true } });
  if (!report || report.ownerUserId !== ownerOf(guestId) || !report.snapshot || report.snapshot.ownerUserId !== ownerOf(guestId)) return notFound();
  const parsed = normalizedProfileSchema.safeParse(report.snapshot.data);
  const address = parsed.success && Object.hasOwn(parsed.data.images, key) ? parsed.data.images[key] : null;
  if (!address) return notFound();
  const image = address.startsWith("fixture:") && report.snapshot.provider.startsWith("Fixture") ? fixtureImage(address) : await fetchProfileImage(address);
  if (!image) return notFound();
  return new NextResponse(new Uint8Array(image.body), {
    headers: {
      ...PUBLIC_HEADERS,
      "content-type": image.contentType,
      "cache-control": "private, max-age=3600",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
