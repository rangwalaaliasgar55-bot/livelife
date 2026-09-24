import { doublePrecision, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const gameSaves = pgTable("game_saves", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mode: text("mode").notNull(),
  playerName: text("player_name").notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  netWorth: doublePrecision("net_worth").notNull(),
  age: integer("age").notNull(),
  country: text("country").notNull(),
  summary: text("summary").notNull(),
  state: jsonb("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GameSaveRow = typeof gameSaves.$inferSelect;
