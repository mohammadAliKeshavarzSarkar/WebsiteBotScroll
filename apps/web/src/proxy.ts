import { NextResponse, type NextRequest } from "next/server";
import { AuthenticationRequired, requireOwnerSession, type AuthStore } from "./lib/auth";
import { getAuthStore } from "./lib/server-auth-store";

export async function protectRequest(request: Request, store: AuthStore): Promise<Response | null> {
  try {
    await requireOwnerSession(request, store);
    return null;
  } catch (error) {
    if (error instanceof AuthenticationRequired) {
      return Response.redirect(new URL(error.location, request.url), 307);
    }
    throw error;
  }
}

export async function proxy(request: NextRequest): Promise<Response> {
  return (await protectRequest(request, getAuthStore())) ?? NextResponse.next();
}

export const config = { matcher: ["/sites/:path*", "/api/sites/:path*"] };
