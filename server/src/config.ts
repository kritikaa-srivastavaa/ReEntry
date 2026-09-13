import "dotenv/config";
import { z } from "zod";
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => /^postgres(ql)?:\/\//.test(value)),
    JWT_SECRET: z
      .string()
      .min(32)
      .refine((s) => !s.includes("replace-with"), "Set a random JWT secret"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.string().default("127.0.0.1"),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    CORS_ORIGINS: z.string().default("http://localhost:5173"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !process.env.CORS_ORIGINS?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["CORS_ORIGINS"],
        message: "Production requires explicit origins",
      });
    }
    for (const origin of env.CORS_ORIGINS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)) {
      try {
        const url = new URL(origin);
        const extension = /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
        const web =
          ["http:", "https:"].includes(url.protocol) && url.origin === origin;
        if (!extension && !web) throw new Error();
        if (env.NODE_ENV === "production" && web && url.protocol !== "https:")
          throw new Error();
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["CORS_ORIGINS"],
          message: "Use exact HTTPS or extension origins in production",
        });
      }
    }
  });
export function readConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}. See .env.example.`,
    );
  return parsed.data;
}
