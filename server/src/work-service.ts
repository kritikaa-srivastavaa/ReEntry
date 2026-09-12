import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import type { Database } from "./db.js";
import { checklistItems, resources, workItems } from "./schema.js";
import type { WorkInput } from "./validation.js";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Executor =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function ownedWork(
  db: Executor,
  userId: string,
  id: string,
  lock = false,
) {
  const query = db
    .select()
    .from(workItems)
    .where(and(eq(workItems.id, id), eq(workItems.userId, userId)));
  const [item] = await (lock ? query.for("update") : query);
  if (!item) throw new HttpError(404, "Work item not found.");
  return item;
}
export async function listWork(
  db: Executor,
  userId: string,
  status?: WorkInput["status"],
  search?: string,
  id?: string,
) {
  const term = search?.replace(/[\\%_]/g, "\\$&");
  const rows = await db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.userId, userId),
        status ? eq(workItems.status, status) : undefined,
        id ? eq(workItems.id, id) : undefined,
        term
          ? or(
              ...[
                workItems.title,
                workItems.category,
                workItems.goal,
                workItems.nextAction,
                workItems.whereILeftOff,
              ].map((field) => ilike(field, `%${term}%`)),
            )
          : undefined,
      ),
    )
    .orderBy(
      asc(workItems.status),
      desc(workItems.updatedAt),
      asc(workItems.id),
    );
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const checks = await db
    .select()
    .from(checklistItems)
    .where(inArray(checklistItems.workItemId, ids))
    .orderBy(asc(checklistItems.position));
  const links = await db
    .select()
    .from(resources)
    .where(inArray(resources.workItemId, ids))
    .orderBy(asc(resources.createdAt), asc(resources.id));
  return rows.map(({ userId: _userId, ...row }) => ({
    ...row,
    checklist: checks
      .filter((c) => c.workItemId === row.id)
      .map(({ workItemId: _id, ...c }) => c),
    resources: links
      .filter((r) => r.workItemId === row.id)
      .map(({ workItemId: _id, ...r }) => r),
  }));
}
export async function replaceChildren(
  db: Executor,
  id: string,
  input: Partial<WorkInput>,
) {
  if (input.checklist) {
    const ids = input.checklist.flatMap((c) => (c.id ? [c.id] : []));
    if (new Set(ids).size !== ids.length)
      throw new HttpError(400, "Checklist IDs must be unique.");
    const existing = ids.length
      ? await db
          .select()
          .from(checklistItems)
          .where(inArray(checklistItems.id, ids))
      : [];
    if (existing.some((c) => c.workItemId !== id))
      throw new HttpError(404, "Checklist item not found.");
    await db.delete(checklistItems).where(eq(checklistItems.workItemId, id));
    if (input.checklist.length)
      await db.insert(checklistItems).values(
        input.checklist.map((c, position) => ({
          ...c,
          position,
          workItemId: id,
          createdAt: existing.find((old) => old.id === c.id)?.createdAt,
          updatedAt: new Date(),
        })),
      );
  }
  if (input.resources) {
    const ids = input.resources.flatMap((r) => (r.id ? [r.id] : []));
    if (
      new Set(ids).size !== ids.length ||
      new Set(input.resources.map((r) => r.url)).size !== input.resources.length
    )
      throw new HttpError(
        400,
        "Resource IDs and URLs must be unique within a work item.",
      );
    const existing = ids.length
      ? await db.select().from(resources).where(inArray(resources.id, ids))
      : [];
    if (existing.some((r) => r.workItemId !== id))
      throw new HttpError(404, "Resource not found.");
    await db.delete(resources).where(eq(resources.workItemId, id));
    if (input.resources.length)
      await db.insert(resources).values(
        input.resources.map((r) => ({
          ...r,
          workItemId: id,
          createdAt: existing.find((old) => old.id === r.id)?.createdAt,
          updatedAt: new Date(),
        })),
      );
  }
}
export async function createWork(
  db: Executor,
  userId: string,
  input: WorkInput,
  dates?: { createdAt: Date; updatedAt: Date },
) {
  const { checklist, resources: links, ...fields } = input;
  const [item] = await db
    .insert(workItems)
    .values({ ...fields, userId, ...dates })
    .returning();
  // The server allocates IDs on create; legacy IDs are tracked only by import receipts.
  await replaceChildren(db, item.id, {
    checklist: checklist.map(({ id: _id, ...c }) => c),
    resources: links.map(({ id: _id, ...r }) => r),
  });
  return item;
}
