import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  slackUserId: text("slack_user_id").notNull(),
  slackChannelId: text("slack_channel_id").notNull(),
  slackThreadTs: text("slack_thread_ts"),
  request: text("request").notNull(),
  status: text("status").$type<"pending" | "pm" | "coding" | "qa" | "done" | "error">().default("pending"),
  pmSpec: text("pm_spec"),
  code: text("code"),
  codeLanguage: text("code_language").default("python"),
  testResult: jsonb("test_result").$type<{ passed: boolean; output?: string; error?: string }>(),
  finalOutput: text("final_output"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const memory = pgTable("memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  slackUserId: text("slack_user_id").notNull(),
  content: text("content").notNull(),
  category: text("category").default("general"),
  createdAt: timestamp("created_at").defaultNow(),
});
