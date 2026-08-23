import { getAuth0 } from "@/backend/lib/auth0";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ auth0: string }> }
) {
  try {
    const { auth0: endpoint } = await params;
    const { auth0, isAuth0Configured } = getAuth0();

    if (!isAuth0Configured || !auth0) {
      console.error("[Auth0 Route] Auth0 not configured:", {
        isAuth0Configured,
        hasAuth0Client: !!auth0,
        endpoint,
        envVars: {
          hasSecret: !!process.env.AUTH0_SECRET,
          hasDomain: !!process.env.AUTH0_DOMAIN,
          hasClientId: !!process.env.AUTH0_CLIENT_ID,
          hasClientSecret: !!process.env.AUTH0_CLIENT_SECRET,
          hasAppBaseUrl: !!process.env.APP_BASE_URL,
          hasNextPublicAppUrl: !!process.env.NEXT_PUBLIC_APP_URL,
        },
      });
      return NextResponse.json(
        { error: "Authentication service is not configured" },
        { status: 503 }
      );
    }

		const baseUrl = new URL(req.url).origin;
		const requestUrl = new URL(req.url);

		// Auth0 Business Users applications require an organization on login.
		// Keep the client-facing flow credentials-first by supplying the approved
		// organization ID server-side; clients never need to type its name.
		if (endpoint === "login" && !requestUrl.searchParams.has("organization")) {
			const organizationId = process.env.AUTH0_ORGANIZATION_ID?.trim();
			if (!organizationId) {
				return NextResponse.json(
					{ error: "B2B organization login is not configured" },
					{ status: 503 },
				);
			}
			requestUrl.searchParams.set("organization", organizationId);
		}

		// Create a request-like object for the Auth0 client
		const auth0Request = new Request(
			`${baseUrl}/auth/${endpoint}${requestUrl.search}`,
      {
        method: req.method,
        headers: new Headers(req.headers),
      }
    );

    return await auth0.handleAuth()(auth0Request);
  } catch (error) {
    console.error("[Auth0 Route Error]", error);
    return NextResponse.json(
      { error: "Authentication request failed" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auth0: string }> }
) {
  return GET(req, { params });
}
