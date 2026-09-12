import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  uniqueIndex,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
const dates = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const workStatus = pgEnum("work_status", [
  "IN_PROGRESS",
  "NOT_STARTED",
  "DONE",
]);
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  ...dates(),
});
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);
export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category").notNull(),
    goal: text("goal").notNull().default(""),
    status: workStatus("status").notNull().default("NOT_STARTED"),
    whereILeftOff: text("where_i_left_off").notNull().default(""),
    nextAction: text("next_action").notNull().default(""),
    ...dates(),
  },
  (t) => [
    index("work_items_user_status_updated_idx").on(
      t.userId,
      t.status,
      t.updatedAt,
    ),
  ],
);
export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    completed: boolean("completed").notNull().default(false),
    position: integer("position").notNull(),
    ...dates(),
  },
  (t) => [index("checklist_work_idx").on(t.workItemId)],
);
export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    ...dates(),
  },
  (t) => [uniqueIndex("resource_work_url_unique").on(t.workItemId, t.url)],
);
// Retain migration receipts even if the imported work item is later deleted.
export const imports = pgTable(
  "v1_imports",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    workItemId: uuid("work_item_id").references(() => workItems.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sourceId] })],
);
