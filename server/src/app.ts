import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z, ZodError } from "zod";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "./db.js";
import {
  users,
  sessions,
  workItems,
  checklistItems,
  resources,
  imports,
} from "./schema.js";
import {
  credentialsSchema,
  idSchema,
  importSchema,
  patchSchema,
  resourceSchema,
  statusSchema,
  workSchema,
} from "./validation.js";
import {
  HttpError,
  createWork,
  listWork,
  ownedWork,
  replaceChildren,
} from "./work-service.js";

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route =
  (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res))
      .then(() => {
        if (!res.headersSent) next();
      })
      .catch(next);
  };
const publicUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  email: u.email,
});
const dummyHash = bcrypt.hashSync("nonexistent-account-password", 12);
export function createApp(
  db: Database,
  config: { jwtSecret: string; origins: string[]; trustProxyHops?: number },
) {
  const app = express();
  app.disable("x-powered-by");
  // Enable only for a host with a known, fixed reverse-proxy topology.
  app.set("trust proxy", config.trustProxyHops ?? 0);
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        callback(
          origin && !config.origins.includes(origin)
            ? new HttpError(403, "Origin is not allowed.")
            : null,
          true,
        );
      },
    }),
  );
  app.use(express.json({ limit: "5mb" }));
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many authentication attempts. Try again later." },
  });
  const apiLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Try again shortly." },
  });
  app.use("/api", apiLimit);
  app.get(
    "/api/health",
    route(async (_req, res) => {
      await db.execute(sql`select 1`);
      res.json({ status: "ok" });
    }),
  );
  async function issueSession(user: typeof users.$inferSelect) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [session] = await db
      .insert(sessions)
      .values({ userId: user.id, expiresAt })
      .returning();
    return {
      user: publicUser(user),
      token: jwt.sign({ sid: session.id }, config.jwtSecret, {
        algorithm: "HS256",
        subject: user.id,
        audience: "reentry",
        issuer: "reentry-api",
        expiresIn: "7d",
      }),
      expiresAt: expiresAt.toISOString(),
    };
  }
  app.post(
    "/api/auth/register",
    authLimit,
    route(async (req, res) => {
      const body = credentialsSchema.parse(req.body);
      const passwordHash = await bcrypt.hash(body.password, 12);
      const [user] = await db
        .insert(users)
        .values({ email: body.email, passwordHash })
        .onConflictDoNothing()
        .returning();
      if (!user)
        throw new HttpError(
          409,
          "Unable to register this email. Try logging in.",
        );
      res.status(201).json(await issueSession(user));
    }),
  );
  app.post(
    "/api/auth/login",
    authLimit,
    route(async (req, res) => {
      const body = credentialsSchema.parse(req.body);
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, body.email));
      const valid = await bcrypt.compare(
        body.password,
        user?.passwordHash ?? dummyHash,
      );
      if (!user || !valid)
        throw new HttpError(401, "Email or password is incorrect.");
      res.json(await issueSession(user));
    }),
  );
  app.use(
    "/api",
    route(async (req, res) => {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new HttpError(401, "Log in to continue.");
      let claims: jwt.JwtPayload;
      try {
        const decoded = jwt.verify(token, config.jwtSecret, {
          algorithms: ["HS256"],
          audience: "reentry",
          issuer: "reentry-api",
        });
        if (typeof decoded === "string") throw new Error();
        claims = decoded;
        idSchema.parse(claims.sub);
        idSchema.parse(claims.sid);
      } catch {
        throw new HttpError(401, "Your session has expired. Log in again.");
      }
      const [session] = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.id, claims.sid as string),
            eq(sessions.userId, claims.sub!),
            gt(sessions.expiresAt, new Date()),
          ),
        );
      if (!session)
        throw new HttpError(401, "Your session has ended. Log in again.");
      res.locals.userId = session.userId;
      res.locals.sessionId = session.id;
    }),
  );
  app.get(
    "/api/auth/me",
    route(async (_req, res) => {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, res.locals.userId));
      if (!user) throw new HttpError(401, "Session not found.");
      res.json({ user: publicUser(user) });
    }),
  );
  app.post(
    "/api/auth/logout",
    route(async (_req, res) => {
      await db.delete(sessions).where(eq(sessions.id, res.locals.sessionId));
      res.status(204).end();
    }),
  );
  app.get(
    "/api/work-items",
    route(async (req, res) => {
      const query = z
        .object({
          status: statusSchema.optional(),
          search: z.string().max(2000).optional(),
        })
        .strict()
        .parse(req.query);
      res.json({
        items: await db.transaction(
          (tx) => listWork(tx, res.locals.userId, query.status, query.search),
          { isolationLevel: "repeatable read" },
        ),
      });
    }),
  );
  app.post(
    "/api/work-items/import",
    route(async (req, res) => {
      const body = importSchema.parse(req.body);
      const result = await db.transaction(async (tx) => {
        let imported = 0;
        for (const legacy of body.items) {
          const sourceId = `${body.sourceId}:${legacy.id}`;
          const [receipt] = await tx
            .insert(imports)
            .values({ userId: res.locals.userId, sourceId })
            .onConflictDoNothing()
            .returning();
          if (!receipt) continue;
          const { id: _id, createdAt, updatedAt, ...fields } = legacy;
          const item = await createWork(
            tx,
            res.locals.userId,
            {
              ...fields,
              checklist: fields.checklist.map(({ id: _c, ...c }) => c),
              resources: fields.resources
                .filter(
                  (r, i, all) =>
                    all.findIndex((other) => other.url === r.url) === i,
                )
                .map(({ id: _r, ...r }) => r),
            },
            { createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) },
          );
          await tx
            .update(imports)
            .set({ workItemId: item.id })
            .where(
              and(
                eq(imports.userId, res.locals.userId),
                eq(imports.sourceId, sourceId),
              ),
            );
          imported++;
        }
        return { imported, skipped: body.items.length - imported };
      });
      res.json(result);
    }),
  );
  app.get(
    "/api/work-items/:id",
    route(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const items = await db.transaction(
        (tx) => listWork(tx, res.locals.userId, undefined, undefined, id),
        { isolationLevel: "repeatable read" },
      );
      if (!items[0]) throw new HttpError(404, "Work item not found.");
      res.json({ item: items[0] });
    }),
  );
  app.post(
    "/api/work-items",
    route(async (req, res) => {
      const input = workSchema.parse(req.body);
      const item = await db.transaction(async (tx) => {
        const created = await createWork(tx, res.locals.userId, input);
        return (
          await listWork(
            tx,
            res.locals.userId,
            undefined,
            undefined,
            created.id,
          )
        )[0];
      });
      res.status(201).json({ item });
    }),
  );
  app.patch(
    "/api/work-items/:id",
    route(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const input = patchSchema.parse(req.body);
      const item = await db.transaction(async (tx) => {
        await ownedWork(tx, res.locals.userId, id, true);
        const { checklist: _checks, resources: _links, ...fields } = input;
        await tx
          .update(workItems)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(workItems.id, id));
        await replaceChildren(tx, id, input);
        return (
          await listWork(tx, res.locals.userId, undefined, undefined, id)
        )[0];
      });
      res.json({ item });
    }),
  );
  app.delete(
    "/api/work-items/:id",
    route(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const deleted = await db
        .delete(workItems)
        .where(
          and(eq(workItems.id, id), eq(workItems.userId, res.locals.userId)),
        )
        .returning();
      if (!deleted.length) throw new HttpError(404, "Work item not found.");
      res.status(204).end();
    }),
  );
  app.patch(
    "/api/work-items/:id/checklist/:checkId",
    route(async (req, res) => {
      const id = idSchema.parse(req.params.id),
        checkId = idSchema.parse(req.params.checkId);
      const input = z
        .object({ completed: z.boolean() })
        .strict()
        .parse(req.body);
      await db.transaction(async (tx) => {
        await ownedWork(tx, res.locals.userId, id, true);
        const changed = await tx
          .update(checklistItems)
          .set({ ...input, updatedAt: new Date() })
          .where(
            and(
              eq(checklistItems.id, checkId),
              eq(checklistItems.workItemId, id),
            ),
          )
          .returning();
        if (!changed.length)
          throw new HttpError(404, "Checklist item not found.");
        await tx
          .update(workItems)
          .set({ updatedAt: new Date() })
          .where(eq(workItems.id, id));
      });
      res.status(204).end();
    }),
  );
  app.post(
    "/api/work-items/:id/resources",
    route(async (req, res) => {
      const id = idSchema.parse(req.params.id),
        input = resourceSchema.omit({ id: true }).parse(req.body);
      const resource = await db.transaction(async (tx) => {
        await ownedWork(tx, res.locals.userId, id, true);
        await tx
          .insert(resources)
          .values({ ...input, workItemId: id })
          .onConflictDoNothing();
        await tx
          .update(workItems)
          .set({ updatedAt: new Date() })
          .where(eq(workItems.id, id));
        return (
          await tx
            .select()
            .from(resources)
            .where(
              and(eq(resources.workItemId, id), eq(resources.url, input.url)),
            )
        )[0];
      });
      res.status(201).json({ resource });
    }),
  );
  app.delete(
    "/api/resources/:id",
    route(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      await db.transaction(async (tx) => {
        const [link] = await tx
          .select({ workItemId: resources.workItemId })
          .from(resources)
          .innerJoin(workItems, eq(workItems.id, resources.workItemId))
          .where(
            and(eq(resources.id, id), eq(workItems.userId, res.locals.userId)),
          );
        if (!link) throw new HttpError(404, "Resource not found.");
        await ownedWork(tx, res.locals.userId, link.workItemId, true);
        await tx.delete(resources).where(eq(resources.id, id));
        await tx
          .update(workItems)
          .set({ updatedAt: new Date() })
          .where(eq(workItems.id, link.workItemId));
      });
      res.status(204).end();
    }),
  );
  app.use((_req, _res, next) =>
    next(new HttpError(404, "Endpoint not found.")),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: "Invalid request.",
          details: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
        return;
      }
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "entity.parse.failed"
      ) {
        res.status(400).json({ error: "Malformed JSON." });
        return;
      }
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "entity.too.large"
      ) {
        res.status(413).json({ error: "Request is too large." });
        return;
      }
      res.status(500).json({
        error: "The server could not complete this request. Try again.",
      });
    },
  );
  return app;
}
