import { createHash, randomBytes } from "node:crypto";
import { verify } from "argon2";

const SESSION_COOKIE = "website_bot_scroll_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthUser = {
  id: string;
  organizationId: string;
  email: string;
  passwordHash: string;
};

export type OwnerSession = { organizationId: string; userId: string };

export type AuthStore = {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  createSession(input: { userId: string; tokenDigest: string; expiresAt: Date }): Promise<void>;
  findSessionByDigest(digest: string): Promise<(OwnerSession & { expiresAt: Date }) | null>;
  deleteSessionByDigest(digest: string): Promise<void>;
  recordAuditEvent(input: {
    organizationId: string;
    userId: string;
    action: "auth.login" | "auth.logout";
  }): Promise<void>;
};

export class AuthenticationRequired extends Error {
  constructor(readonly location: string) {
    super("Authentication required");
    this.name = "AuthenticationRequired";
  }
}

export class InvalidCredentials extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentials";
  }
}

function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenFromRequest(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=") || null;
  }
  return null;
}

export async function loginOwner(
  credentials: { email: string; password: string },
  store: AuthStore,
  now = new Date(),
): Promise<{ token: string; digest: string; cookie: string }> {
  const user = await store.findUserByEmail(credentials.email.trim().toLowerCase());
  if (!user || !(await verify(user.passwordHash, credentials.password))) {
    throw new InvalidCredentials();
  }

  const token = randomBytes(32).toString("base64url");
  const digest = digestToken(token);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await store.createSession({ userId: user.id, tokenDigest: digest, expiresAt });
  await store.recordAuditEvent({
    organizationId: user.organizationId,
    userId: user.id,
    action: "auth.login",
  });

  return {
    token,
    digest,
    cookie: `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`,
  };
}

export async function requireOwnerSession(
  request: Request,
  store: AuthStore,
  now = new Date(),
): Promise<OwnerSession> {
  const token = tokenFromRequest(request);
  if (!token) throw new AuthenticationRequired("/login");
  const session = await store.findSessionByDigest(digestToken(token));
  if (!session || session.expiresAt <= now) throw new AuthenticationRequired("/login");
  return { organizationId: session.organizationId, userId: session.userId };
}

export async function logoutOwner(
  request: Request,
  store: AuthStore,
  actor: OwnerSession,
): Promise<string> {
  const token = tokenFromRequest(request);
  if (token) await store.deleteSessionByDigest(digestToken(token));
  await store.recordAuditEvent({ ...actor, action: "auth.logout" });
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
