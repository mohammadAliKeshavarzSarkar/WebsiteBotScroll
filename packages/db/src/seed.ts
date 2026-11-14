import { hash } from "argon2";
import type { AppEnv } from "@website-bot-scroll/config";
import type { DatabaseClient } from "./client.js";

export async function bootstrapOwner(environment: AppEnv, prisma: DatabaseClient): Promise<void> {
  const passwordHash = await hash(environment.BOOTSTRAP_OWNER_PASSWORD, { type: 2 });
  environment.BOOTSTRAP_OWNER_PASSWORD = "";

  await prisma.organization.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    update: { name: "WebsiteBotScroll" },
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "WebsiteBotScroll",
      users: {
        create: {
          email: environment.BOOTSTRAP_OWNER_EMAIL.toLowerCase(),
          passwordHash,
        },
      },
    },
  });
}
