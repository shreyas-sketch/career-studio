import { NextResponse } from "next/server";

import { fetchProfileImage, fixtureImage } from "@/lib/fde/media";
import { normalizedProfileSchema } from "@/lib/fde/types";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/route";
import { requireUserId } from "@/lib/tenancy/context";

// A profile's image, by its key in a snapshot this account owns. The address
// itself never comes from the request, so this can't be pointed anywhere else.

const notFound = () => new NextResponse(null, { status: 404 });

export const GET = route<RouteContext<"/api/fde/media/[snapshotId]/[key]">>(async (_request, { params }) => {
  const { snapshotId, key } = await params;
  const snapshot = await prisma.fdeProfileSnapshot.findUnique({ where: { id: snapshotId } });
  if (!snapshot || snapshot.ownerUserId !== requireUserId()) return notFound();
  const parsed = normalizedProfileSchema.safeParse(snapshot.data);
  const address = parsed.success && Object.hasOwn(parsed.data.images, key) ? parsed.data.images[key] : null;
  if (!address) return notFound();
  const image = address.startsWith("fixture:") && snapshot.provider.startsWith("Fixture") ? fixtureImage(address) : await fetchProfileImage(address);
  if (!image) return notFound();
  return new NextResponse(new Uint8Array(image.body), {
    headers: {
      "content-type": image.contentType,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
