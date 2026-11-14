import { InvalidCredentials, loginOwner, type AuthStore } from "../../../../lib/auth";
import { getAuthStore } from "../../../../lib/server-auth-store";

export async function handleLogin(request: Request, store: AuthStore): Promise<Response> {
  const form = await request.formData();
  const email = form.get("email");
  const password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string") {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  try {
    const session = await loginOwner({ email, password }, store);
    return new Response(null, {
      status: 303,
      headers: {
        location: new URL("/sites", request.url).toString(),
        "set-cookie": session.cookie,
      },
    });
  } catch (error) {
    if (error instanceof InvalidCredentials) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleLogin(request, getAuthStore());
}
