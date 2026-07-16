import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

export type TicketSection = "generale" | "donazioni" | "partnership" | "segnalazioni";

export interface WarningRecord {
  id: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string;
  createdAt: string;
}

export interface TicketConfig {
  guildId: string;
  section: TicketSection;
  categoryId: string;
  panelChannelId: string;
  staffRoleId: string | null;
  logChannelId: string | null;
}

export interface TicketFeedbackRecord {
  id: number;
  guildId: string;
  ticketNumber: number;
  ownerId: string;
  rating: number;
  createdAt: string;
}

export interface TicketRecord {
  channelId: string;
  guildId: string;
  ownerId: string;
  section: TicketSection;
  ticketNumber: number;
  claimedBy: string | null;
  controlMessageId: string | null;
  createdAt: string;
}

const databasePath = resolve(config.DATABASE_PATH);
mkdirSync(dirname(databasePath), { recursive: true });

export const database = new DatabaseSync(databasePath);
database.exec(`
  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ticket_sections (
    guild_id TEXT NOT NULL,
    section TEXT NOT NULL,
    category_id TEXT NOT NULL,
    panel_channel_id TEXT NOT NULL,
    staff_role_id TEXT,
    log_channel_id TEXT,
    PRIMARY KEY (guild_id, section)
  );

  CREATE TABLE IF NOT EXISTS ticket_counters (
    guild_id TEXT PRIMARY KEY,
    last_number INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ticket_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    ticket_number INTEGER NOT NULL,
    owner_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, ticket_number, owner_id)
  );

  CREATE TABLE IF NOT EXISTS tickets (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    section TEXT NOT NULL DEFAULT 'generale',
    ticket_number INTEGER NOT NULL DEFAULT 0,
    claimed_by TEXT,
    control_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

for (const statement of [
  "ALTER TABLE tickets ADD COLUMN section TEXT NOT NULL DEFAULT 'generale'",
  "ALTER TABLE tickets ADD COLUMN ticket_number INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE tickets ADD COLUMN claimed_by TEXT",
  "ALTER TABLE tickets ADD COLUMN control_message_id TEXT"
]) {
  try { database.exec(statement); } catch { /* colonna già presente */ }
}

export function createWarning(guildId: string, userId: string, moderatorId: string, reason: string): void {
  database.prepare(`INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)`).run(guildId, userId, moderatorId, reason);
}

export function getWarnings(guildId: string, userId: string): WarningRecord[] {
  return database.prepare(`
    SELECT id, guild_id AS guildId, user_id AS userId, moderator_id AS moderatorId,
           reason, created_at AS createdAt
    FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 10
  `).all(guildId, userId) as unknown as WarningRecord[];
}

export function saveTicketConfig(ticketConfig: TicketConfig): void {
  database.prepare(`
    INSERT INTO ticket_sections (guild_id, section, category_id, panel_channel_id, staff_role_id, log_channel_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, section) DO UPDATE SET
      category_id = excluded.category_id,
      panel_channel_id = excluded.panel_channel_id,
      staff_role_id = excluded.staff_role_id,
      log_channel_id = excluded.log_channel_id
  `).run(ticketConfig.guildId, ticketConfig.section, ticketConfig.categoryId, ticketConfig.panelChannelId, ticketConfig.staffRoleId, ticketConfig.logChannelId);
}

export function getTicketConfig(guildId: string, section: TicketSection): TicketConfig | undefined {
  return database.prepare(`
    SELECT guild_id AS guildId, section, category_id AS categoryId, panel_channel_id AS panelChannelId,
           staff_role_id AS staffRoleId, log_channel_id AS logChannelId
    FROM ticket_sections WHERE guild_id = ? AND section = ?
  `).get(guildId, section) as unknown as TicketConfig | undefined;
}

function nextTicketNumber(guildId: string): number {
  database.prepare(`
    INSERT INTO ticket_counters (guild_id, last_number) VALUES (?, 1)
    ON CONFLICT(guild_id) DO UPDATE SET last_number = last_number + 1
  `).run(guildId);
  const row = database.prepare(`SELECT last_number AS lastNumber FROM ticket_counters WHERE guild_id = ?`).get(guildId) as unknown as { lastNumber: number };
  return row.lastNumber;
}

export function createTicket(channelId: string, guildId: string, ownerId: string, section: TicketSection): number {
  const ticketNumber = nextTicketNumber(guildId);
  database.prepare(`
    INSERT INTO tickets (channel_id, guild_id, owner_id, section, ticket_number)
    VALUES (?, ?, ?, ?, ?)
  `).run(channelId, guildId, ownerId, section, ticketNumber);
  return ticketNumber;
}

export function setTicketControlMessage(channelId: string, messageId: string): void {
  database.prepare(`UPDATE tickets SET control_message_id = ? WHERE channel_id = ?`).run(messageId, channelId);
}

export function claimTicket(channelId: string, staffUserId: string): void {
  database.prepare(`UPDATE tickets SET claimed_by = ? WHERE channel_id = ?`).run(staffUserId, channelId);
}

export function transferTicket(channelId: string, section: TicketSection): void {
  database.prepare(`UPDATE tickets SET section = ? WHERE channel_id = ?`).run(section, channelId);
}

export function getOpenTicketByOwner(guildId: string, ownerId: string, section: TicketSection): { channelId: string } | undefined {
  return database.prepare(`SELECT channel_id AS channelId FROM tickets WHERE guild_id = ? AND owner_id = ? AND section = ? LIMIT 1`).get(guildId, ownerId, section) as unknown as { channelId: string } | undefined;
}

export function getTicket(channelId: string): TicketRecord | undefined {
  return database.prepare(`
    SELECT channel_id AS channelId, guild_id AS guildId, owner_id AS ownerId, section,
           ticket_number AS ticketNumber, claimed_by AS claimedBy,
           control_message_id AS controlMessageId, created_at AS createdAt
    FROM tickets WHERE channel_id = ?
  `).get(channelId) as unknown as TicketRecord | undefined;
}

export function deleteTicket(channelId: string): void {
  database.prepare(`DELETE FROM tickets WHERE channel_id = ?`).run(channelId);
}


export function saveTicketFeedback(guildId: string, ticketNumber: number, ownerId: string, rating: number): void {
  database.prepare(`
    INSERT INTO ticket_feedback (guild_id, ticket_number, owner_id, rating)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, ticket_number, owner_id) DO UPDATE SET
      rating = excluded.rating,
      created_at = CURRENT_TIMESTAMP
  `).run(guildId, ticketNumber, ownerId, rating);
}

export function getTicketFeedback(guildId: string, ticketNumber: number): TicketFeedbackRecord | undefined {
  return database.prepare(`
    SELECT id, guild_id AS guildId, ticket_number AS ticketNumber, owner_id AS ownerId,
           rating, created_at AS createdAt
    FROM ticket_feedback WHERE guild_id = ? AND ticket_number = ?
  `).get(guildId, ticketNumber) as unknown as TicketFeedbackRecord | undefined;
}
