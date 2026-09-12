import "dotenv/config";
import { z } from "zod";
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z
    .string()
    .min(32)
    .refine((s) => !s.includes("replace-with"), "Set a random JWT secret"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("127.0.0.1"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
});
export function readConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}. See .env.example.`,
    );
  return parsed.data;
}
