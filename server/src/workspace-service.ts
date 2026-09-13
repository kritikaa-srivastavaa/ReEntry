import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Database } from "./db.js";
import { resources, workCheckpoints, workItems } from "./schema.js";
import type { checkpointSchema } from "./validation.js";
import { HttpError, ownedWork, type Executor } from "./work-service.js";

type Link = { title: string; url: string };
const normalized = (value: string) => {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
};
// The caller holds the parent row lock so concurrent saves cannot duplicate URLs.
export async function addResources(
  db: Executor,
  id: string,
  links: Link[],
  source: "MANUAL" | "WORKSPACE",
) {
  const existing = await db
    .select()
    .from(resources)
    .where(eq(resources.workItemId, id));
  let position = existing.reduce((max, r) => Math.max(max, r.position), -1) + 1;
  const unique = new Map(links.map((r) => [normalized(r.url), r]));
  const additions = [...unique.keys()].filter(
    (url) => !existing.some((r) => normalized(r.url) === url),
  );
  if (existing.length + additions.length > 500)
    throw new HttpError(
      400,
      "A work item can hold up to 500 resources. Remove unused resources first.",
    );
  const saved = [];
  for (const [url, link] of unique) {
    const old = existing.find((r) => normalized(r.url) === url);
    if (old) {
      if (source === "WORKSPACE") {
        const [updated] = await db
          .update(resources)
          .set({ source, title: link.title, updatedAt: new Date() })
          .where(eq(resources.id, old.id))
          .returning();
        saved.push(updated);
      } else saved.push(old);
    } else {
      const [created] = await db
        .insert(resources)
        .values({ ...link, url, workItemId: id, source, position: position++ })
        .returning();
      saved.push(created);
    }
  }
  return saved;
}
const publicCheckpoint = ({
  requestId: _requestId,
  payloadHash: _hash,
  ...checkpoint
}: typeof workCheckpoints.$inferSelect) => checkpoint;
export async function saveCheckpoint(
  db: Database,
  userId: string,
  id: string,
  input: z.infer<typeof checkpointSchema>,
) {
  return db.transaction(async (tx) => {
    await ownedWork(tx, userId, id, true);
    const { requestId, ...content } = input;
    const payloadHash = createHash("sha256")
      .update(JSON.stringify(content))
      .digest("hex");
    const [old] = await tx
      .select()
      .from(workCheckpoints)
      .where(
        and(
          eq(workCheckpoints.workItemId, id),
          eq(workCheckpoints.requestId, requestId),
        ),
      );
    if (old) {
      if (old.payloadHash !== payloadHash)
        throw new HttpError(
          409,
          "This checkpoint attempt already saved different content. Check Recent progress before starting another checkpoint.",
        );
      return publicCheckpoint(old);
    }
    if (input.resources)
      await addResources(tx, id, input.resources, "WORKSPACE");
    await tx
      .update(workItems)
      .set({
        whereILeftOff: input.whereILeftOff,
        nextAction: input.nextAction,
        updatedAt: new Date(),
      })
      .where(eq(workItems.id, id));
    const [checkpoint] = await tx
      .insert(workCheckpoints)
      .values({
        workItemId: id,
        whereILeftOff: input.whereILeftOff,
        nextAction: input.nextAction,
        requestId,
        payloadHash,
      })
      .returning();
    return publicCheckpoint(checkpoint);
  });
}
export async function checkpointHistory(
  db: Database,
  userId: string,
  id: string,
  limit: number,
  offset: number,
) {
  return db.transaction(
    async (tx) => {
      await ownedWork(tx, userId, id);
      const rows = await tx
        .select()
        .from(workCheckpoints)
        .where(eq(workCheckpoints.workItemId, id))
        .orderBy(desc(workCheckpoints.createdAt), desc(workCheckpoints.id))
        .limit(limit + 1)
        .offset(offset);
      return {
        checkpoints: rows.slice(0, limit).map(publicCheckpoint),
        hasMore: rows.length > limit,
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
