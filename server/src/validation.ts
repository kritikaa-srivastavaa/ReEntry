import { z } from "zod";
export const idSchema = z.string().uuid();
export const statusSchema = z.enum(["IN_PROGRESS", "NOT_STARTED", "DONE"]);
export const credentialsSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z
      .string()
      .min(10)
      .refine(
        (s) => Buffer.byteLength(s, "utf8") <= 72,
        "Password must be at most 72 UTF-8 bytes",
      ),
  })
  .strict();
const urlSchema = z
  .string()
  .max(8192)
  .url()
  .refine((s) => {
    try {
      const url = new URL(s);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Use an http or https URL without embedded credentials")
  .transform((s) => new URL(s).href);
export const resourceSchema = z
  .object({
    id: idSchema.optional(),
    title: z.string().trim().min(1).max(2000),
    url: urlSchema,
    source: z.enum(["MANUAL", "WORKSPACE"]).optional(),
  })
  .strict();
const checkSchema = z
  .object({
    id: idSchema.optional(),
    text: z.string().trim().min(1).max(2000),
    completed: z.boolean(),
  })
  .strict();
export const workSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(60),
    goal: z.string().max(20000).default(""),
    status: statusSchema.default("NOT_STARTED"),
    whereILeftOff: z.string().max(20000).default(""),
    nextAction: z.string().max(20000).default(""),
    checklist: z.array(checkSchema).max(500).default([]),
    resources: z.array(resourceSchema).max(500).default([]),
  })
  .strict();
export const patchSchema = workSchema
  .partial()
  .refine((p) => Object.keys(p).length > 0, "Provide at least one field");
export type WorkInput = z.infer<typeof workSchema>;
export const workspaceSchema = z
  .object({
    resources: z
      .array(resourceSchema.pick({ title: true, url: true }))
      .min(1)
      .max(50),
  })
  .strict();
export const checkpointSchema = z
  .object({
    requestId: idSchema,
    whereILeftOff: z.string().trim().min(1).max(20000),
    nextAction: z.string().trim().min(1).max(20000),
    resources: workspaceSchema.shape.resources.optional(),
  })
  .strict();
export const importSchema = z
  .object({
    sourceId: z.string().uuid(),
    items: z
      .array(
        workSchema.extend({
          id: z.string().min(1).max(200),
          createdAt: z.string().datetime(),
          updatedAt: z.string().datetime(),
          checklist: z
            .array(checkSchema.extend({ id: z.string().min(1).max(200) }))
            .max(500),
          resources: z
            .array(resourceSchema.extend({ id: z.string().min(1).max(200) }))
            .max(500),
        }),
      )
      .min(1)
      .max(500),
  })
  .strict();
