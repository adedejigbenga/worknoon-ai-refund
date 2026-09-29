import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).default("file:./dev.db"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  ADMIN_API_KEY: z.string().min(1).default("change-me"),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("claude-haiku-4-5-20251001"),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
