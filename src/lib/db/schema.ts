import { pgTable, uuid, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import type { Intent } from "@/types";

// ── Runs: tracks app/script build requests ──

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  slackUserId: text("slack_user_id").notNull(),
  slackChannelId: text("slack_channel_id").notNull(),
  slackThreadTs: text("slack_thread_ts"),
  request: text("request").notNull(),
  status: text("status")
    .$type<"pending" | "pm" | "coding" | "qa" | "done" | "error">()
    .default("pending"),
  pmSpec: text("pm_spec"),
  code: text("code"),
  codeLanguage: text("code_language").default("python"),
  testResult: jsonb("test_result").$type<{ passed: boolean; output?: string; error?: string }>(),
  finalOutput: text("final_output"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Tasks: tracks document, research, analytics requests ──

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  slackUserId: text("slack_user_id").notNull(),
  slackChannelId: text("slack_channel_id").notNull(),
  slackThreadTs: text("slack_thread_ts"),
  type: text("type").$type<"document" | "research" | "analytics">().notNull(),
  request: text("request").notNull(),
  status: text("status")
    .$type<"pending" | "processing" | "done" | "error">()
    .default("pending"),
  result: jsonb("result"),
  outputFilename: text("output_filename"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Memory: per-user persistent context ──

export const memory = pgTable("memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  slackUserId: text("slack_user_id").notNull(),
  content: text("content").notNull(),
  category: text("category").default("general"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── Skills: registry of coworker capabilities ──

export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  category: text("category").default("general"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Intent list for classifier ──
export const INTENTS: Intent[] = ["build", "document", "research", "analytics", "chat", "unclear"];
