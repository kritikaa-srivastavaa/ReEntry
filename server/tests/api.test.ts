import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { connectDatabase } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { createApp } from "../src/app.js";
import { users, workItems } from "../src/schema.js";

test("API integration against isolated PostgreSQL", async (t) => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error(
      "Set TEST_DATABASE_URL (a PostgreSQL role with CREATEDB), or run npm run test:isolated on Windows.",
    );
  const name = `reentry_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const { db, pool } = connectDatabase(url.toString());
  try {
    await migrate(url.toString());
    await migrate(url.toString());
    const secret = randomUUID() + randomUUID();
    const app = createApp(db, {
      jwtSecret: secret,
      origins: ["http://localhost:5173"],
    });
    const password = "correct horse battery staple";
    const a = await request(app)
      .post("/api/auth/register")
      .send({ email: "Alice@example.com", password })
      .expect(201);
    const b = await request(app)
      .post("/api/auth/register")
      .send({ email: "bob@example.com", password })
      .expect(201);
    const tokenA = a.body.token as string,
      tokenB = b.body.token as string;
    const authA = { Authorization: `Bearer ${tokenA}` },
      authB = { Authorization: `Bearer ${tokenB}` };
    const input = {
      title: "Load Balancers",
      category: "System Design",
      status: "IN_PROGRESS",
      goal: "Understand resilience",
      whereILeftOff: "L4 vs L7",
      nextAction: "Study health checks",
      checklist: [{ text: "Read notes", completed: false }],
      resources: [{ title: "Reference", url: "https://example.com/" }],
    };
    const created = await request(app)
      .post("/api/work-items")
      .set(authA)
      .send(input)
      .expect(201);
    const item = created.body.item;
    await t.test(
      "registration, login, validation, password hashing and session lookup",
      async () => {
        assert.equal(a.body.user.email, "alice@example.com");
        assert.equal(a.body.user.passwordHash, undefined);
        const [stored] = await db
          .select()
          .from(users)
          .where(eq(users.id, a.body.user.id));
        assert.notEqual(stored.passwordHash, password);
        assert.match(stored.passwordHash, /^\$2[aby]\$12\$/);
        await request(app)
          .post("/api/auth/register")
          .send({ email: "alice@example.com", password })
          .expect(409);
        await request(app)
          .post("/api/auth/login")
          .send({ email: " ALICE@example.com ", password })
          .expect(200);
        await request(app)
          .post("/api/auth/login")
          .send({ email: "alice@example.com", password: "incorrect password" })
          .expect(401);
        await request(app)
          .post("/api/auth/register")
          .send({ email: "bad", password: "short" })
          .expect(400);
        await request(app)
          .post("/api/auth/register")
          .send({ email: "long@example.com", password: "😀".repeat(30) })
          .expect(400);
        const me = await request(app)
          .get("/api/auth/me")
          .set(authA)
          .expect(200);
        assert.equal(me.body.user.id, a.body.user.id);
      },
    );
    await t.test(
      "every work route is protected and other users cannot read or mutate by ID",
      async () => {
        await request(app).get("/api/work-items").expect(401);
        await request(app).post("/api/work-items").send(input).expect(401);
        await request(app)
          .get(`/api/work-items/${item.id}`)
          .set(authB)
          .expect(404);
        await request(app)
          .patch(`/api/work-items/${item.id}`)
          .set(authB)
          .send({ title: "stolen" })
          .expect(404);
        await request(app)
          .delete(`/api/work-items/${item.id}`)
          .set(authB)
          .expect(404);
        const list = await request(app)
          .get("/api/work-items")
          .set(authB)
          .expect(200);
        assert.deepEqual(list.body.items, []);
        await request(app)
          .get("/api/work-items/not-a-uuid")
          .set(authA)
          .expect(400);
        await request(app)
          .patch(`/api/work-items/${item.id}`)
          .set(authA)
          .send({ userId: b.body.user.id })
          .expect(400);
      },
    );
    await t.test(
      "CRUD, checklist updates, resource deduplication and child ownership",
      async () => {
        await request(app)
          .patch(`/api/work-items/${item.id}`)
          .set(authA)
          .send({ nextAction: "Sketch a design" })
          .expect(200);
        await request(app)
          .patch(`/api/work-items/${item.id}/checklist/${item.checklist[0].id}`)
          .set(authA)
          .send({ completed: true })
          .expect(204);
        await request(app)
          .patch(`/api/work-items/${item.id}/checklist/${item.checklist[0].id}`)
          .set(authB)
          .send({ completed: false })
          .expect(404);
        const ownB = (
          await request(app)
            .post("/api/work-items")
            .set(authB)
            .send({ ...input, checklist: [], resources: [] })
            .expect(201)
        ).body.item;
        await request(app)
          .patch(`/api/work-items/${ownB.id}`)
          .set(authB)
          .send({
            checklist: [
              { id: item.checklist[0].id, text: "stolen", completed: false },
            ],
          })
          .expect(404);
        await request(app)
          .patch(`/api/work-items/${ownB.id}`)
          .set(authB)
          .send({
            resources: [
              {
                id: item.resources[0].id,
                title: "stolen",
                url: "https://example.com/",
              },
            ],
          })
          .expect(404);
        await request(app)
          .patch(`/api/work-items/${ownB.id}/checklist/${item.checklist[0].id}`)
          .set(authB)
          .send({ completed: false })
          .expect(404);
        await request(app)
          .post(`/api/work-items/${item.id}/resources`)
          .set(authB)
          .send({ title: "No", url: "https://example.com/no" })
          .expect(404);
        await request(app)
          .delete(`/api/resources/${item.resources[0].id}`)
          .set(authB)
          .expect(404);
        await request(app)
          .post(`/api/work-items/${item.id}/resources`)
          .set(authA)
          .send({ title: "Unsafe", url: "javascript:alert(1)" })
          .expect(400);
        const link = {
          title: "Saved browser page",
          url: "https://example.com/new",
        };
        const saved = await request(app)
          .post(`/api/work-items/${item.id}/resources`)
          .set(authA)
          .send(link)
          .expect(201);
        await request(app)
          .post(`/api/work-items/${item.id}/resources`)
          .set(authA)
          .send(link)
          .expect(201);
        const detail = (
          await request(app)
            .get(`/api/work-items/${item.id}`)
            .set(authA)
            .expect(200)
        ).body.item;
        assert.equal(detail.resources.length, 2);
        assert.equal(detail.checklist[0].completed, true);
        assert.equal(detail.nextAction, "Sketch a design");
        await request(app)
          .delete(`/api/resources/${saved.body.resource.id}`)
          .set(authA)
          .expect(204);
        await request(app)
          .delete(`/api/work-items/${ownB.id}`)
          .set(authB)
          .expect(204);
        await request(app)
          .get(`/api/work-items/${ownB.id}`)
          .set(authB)
          .expect(404);
      },
    );
    await t.test(
      "status grouping, newest within group, literal search and filtering",
      async () => {
        const ids: string[] = [];
        for (const status of ["DONE", "NOT_STARTED", "IN_PROGRESS"]) {
          const result = await request(app)
            .post("/api/work-items")
            .set(authA)
            .send({ ...input, title: `${status} sample`, status })
            .expect(201);
          ids.push(result.body.item.id);
        }
        await db
          .update(workItems)
          .set({ updatedAt: new Date("2030-01-01T00:00:00Z") })
          .where(eq(workItems.id, ids[0]));
        const list = (
          await request(app).get("/api/work-items").set(authA).expect(200)
        ).body.items;
        assert.deepEqual(
          list.map((i: { status: string }) => i.status),
          ["IN_PROGRESS", "IN_PROGRESS", "NOT_STARTED", "DONE"],
        );
        assert.equal(list[0].id, ids[2]);
        assert.equal(
          (
            await request(app)
              .get("/api/work-items?status=DONE")
              .set(authA)
              .expect(200)
          ).body.items.length,
          1,
        );
        assert.equal(
          (
            await request(app)
              .get("/api/work-items?search=load")
              .set(authA)
              .expect(200)
          ).body.items.length,
          1,
        );
        assert.equal(
          (
            await request(app)
              .get("/api/work-items?search=%25")
              .set(authA)
              .expect(200)
          ).body.items.length,
          0,
        );
        await request(app)
          .get("/api/work-items?status=invalid")
          .set(authA)
          .expect(400);
      },
    );
    await t.test(
      "V1 import is atomic, concurrent-retry safe and keeps deletion receipts",
      async () => {
        const sourceId = randomUUID();
        const legacy = {
          ...input,
          id: "example-1",
          title: "Legacy",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-02-01T00:00:00.000Z",
          checklist: [
            { id: "old-step", text: "First", completed: true },
            { id: "old-step-2", text: "Second", completed: false },
          ],
          resources: [
            {
              id: "old-resource",
              title: "Old link",
              url: "https://example.com/old",
            },
          ],
        };
        const imported = await Promise.all([
          request(app)
            .post("/api/work-items/import")
            .set(authA)
            .send({ sourceId, items: [legacy] }),
          request(app)
            .post("/api/work-items/import")
            .set(authA)
            .send({ sourceId, items: [legacy] }),
        ]);
        imported.forEach((r) => assert.equal(r.status, 200));
        assert.equal(
          imported.reduce((n, r) => n + r.body.imported, 0),
          1,
        );
        const migrated = (
          await request(app).get("/api/work-items?search=Legacy").set(authA)
        ).body.items[0];
        assert.equal(migrated.createdAt, legacy.createdAt);
        assert.equal(migrated.updatedAt, legacy.updatedAt);
        assert.equal(migrated.checklist[0].text, "First");
        assert.equal(migrated.checklist[0].completed, true);
        assert.equal(migrated.resources[0].url, legacy.resources[0].url);
        const bad = {
          ...legacy,
          id: "bad",
          resources: [{ id: "bad-r", title: "No", url: "file:///private" }],
        };
        await request(app)
          .post("/api/work-items/import")
          .set(authA)
          .send({ sourceId, items: [{ ...legacy, id: "not-created" }, bad] })
          .expect(400);
        assert.equal(
          (await request(app).get("/api/work-items?search=Legacy").set(authA))
            .body.items.length,
          1,
        );
        await request(app)
          .delete(`/api/work-items/${migrated.id}`)
          .set(authA)
          .expect(204);
        const retry = await request(app)
          .post("/api/work-items/import")
          .set(authA)
          .send({ sourceId, items: [legacy] })
          .expect(200);
        assert.equal(retry.body.imported, 0);
      },
    );
    await t.test("revocation, expiration, CORS and safe errors", async () => {
      await request(app)
        .get("/api/work-items")
        .set("Origin", "https://untrusted.example")
        .set(authA)
        .expect(403);
      await request(app)
        .post("/api/work-items")
        .set(authA)
        .set("Content-Type", "application/json")
        .send("{")
        .expect(400);
      const expired = jwt.sign({ sid: randomUUID() }, secret, {
        subject: a.body.user.id,
        audience: "reentry",
        issuer: "reentry-api",
        expiresIn: -1,
      });
      await request(app)
        .get("/api/work-items")
        .set("Authorization", `Bearer ${expired}`)
        .expect(401);
      const restartedApp = createApp(db, { jwtSecret: secret, origins: [] });
      await request(restartedApp).get("/api/auth/me").set(authA).expect(200);
      await request(app).post("/api/auth/logout").set(authA).expect(204);
      await request(app).get("/api/auth/me").set(authA).expect(401);
    });
  } finally {
    await pool.end();
    if (!/^reentry_test_[a-f0-9]{32}$/.test(name))
      throw new Error("Unsafe test database cleanup target");
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
