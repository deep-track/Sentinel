import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUser, isInternalOpsRole } from "@/backend/lib/auth";
import { getAuth0 } from "@/backend/lib/auth0";

// The runbook's (Manual D) screenshots. They show other clients' names and
// Back Office data, so they live outside public/ and are served only to
// DeepTrack staff, with the same check as the Back Office layout.
const SHOTS_DIR = path.join(process.cwd(), "content", "help", "d", "shots");

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^d\d+-[a-z0-9-]+\.png$/.test(file)) return new NextResponse("Not found", { status: 404 });

  const { auth0, isAuth0Configured } = getAuth0();
  const authAvailable = isAuth0Configured && Boolean(auth0);
  const devBypass = !authAvailable && process.env.NODE_ENV !== "production";
  if (!authAvailable && !devBypass) return new NextResponse("Not found", { status: 404 });
  if (!devBypass) {
    const user = await getCurrentUser();
    if (!user) return new NextResponse("Sign in required", { status: 401 });
    if (!isInternalOpsRole(user.role)) return new NextResponse("Not found", { status: 404 });
  }

  try {
    const image = await readFile(path.join(SHOTS_DIR, file));
    return new NextResponse(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/png",
        // Only the signed-in browser may keep it; never a shared cache.
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
