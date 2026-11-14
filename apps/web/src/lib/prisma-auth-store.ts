import type { DatabaseClient } from "@website-bot-scroll/db";
import type { AuthStore, AuthUser, OwnerSession } from "./auth";

export class PrismaAuthStore implements AuthStore {
  constructor(private readonly prisma: DatabaseClient) {}

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, organizationId: true, email: true, passwordHash: true },
    });
  }

  async createSession(input: {
    userId: string;
    tokenDigest: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.session.create({ data: input });
  }

  async findSessionByDigest(
    tokenDigest: string,
  ): Promise<(OwnerSession & { expiresAt: Date }) | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenDigest },
      select: {
        expiresAt: true,
        userId: true,
        user: { select: { organizationId: true } },
      },
    });
    return session
      ? {
          userId: session.userId,
          organizationId: session.user.organizationId,
          expiresAt: session.expiresAt,
        }
      : null;
  }

  async deleteSessionByDigest(tokenDigest: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenDigest } });
  }

  async recordAuditEvent(input: {
    organizationId: string;
    userId: string;
    action: "auth.login" | "auth.logout";
  }): Promise<void> {
    await this.prisma.auditEvent.create({ data: input });
  }
}
