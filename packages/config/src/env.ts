import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.url().refine((value) => value.startsWith("postgresql://")),
  REDIS_URL: z.url().refine((value) => value.startsWith("redis://") || value.startsWith("rediss://")),
  AUTH_SECRET: z.string().min(32),
  APP_BASE_URL: z.url(),
  CRAWLER_CONTACT_URL: z.url(),
  BOOTSTRAP_OWNER_EMAIL: z.email(),
  BOOTSTRAP_OWNER_PASSWORD: z.string().min(16),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}
