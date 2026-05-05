import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { app } from "electron";
import path from "node:path";
import type { AIChunkRecord, AIIndexSearchHit } from "@shared/aiTypes";
import { resolveSqliteVecLoadPath } from "./resolveSqliteVecPath";

let db: Database.Database | null = null;
let openedDim = 0;

function dbPath(): string {
  return path.join(app.getPath("userData"), "ai", "vector.sqlite");
}

function createBaseTables(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      book_hash TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      chapter_title TEXT NOT NULL,
      content TEXT NOT NULL,
      char_start INTEGER NOT NULL,
      char_end INTEGER NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_book ON chunks(book_hash);

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      book_hash TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      aborted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
  `);
}

function dropVecTables(database: Database.Database) {
  database.exec(`
    DROP TABLE IF EXISTS vec_embeddings;
    DROP TABLE IF EXISTS id_mapping;
    DELETE FROM chunks;
  `);
}

function createVecTables(database: Database.Database, dim: number) {
  database.exec(`
    CREATE TABLE id_mapping (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id TEXT UNIQUE NOT NULL,
      book_hash TEXT NOT NULL
    );
  `);
  database.exec(
    `CREATE VIRTUAL TABLE vec_embeddings USING vec0(embedding float[${dim}]);`,
  );
  database
    .prepare(
      `INSERT INTO ai_meta(key, value) VALUES ('embedding_dim', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(String(dim));
}

function ensureVecLayer(database: Database.Database, embeddingDim: number) {
  const row = database
    .prepare(`SELECT value FROM ai_meta WHERE key = 'embedding_dim'`)
    .get() as { value: string } | undefined;
  const stored = row ? Number.parseInt(row.value, 10) : NaN;
  const vecTbl = database
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='vec_embeddings'`,
    )
    .get();

  const needRebuild =
    !vecTbl || !Number.isFinite(stored) || stored !== embeddingDim;

  if (needRebuild) {
    dropVecTables(database);
    createVecTables(database, embeddingDim);
  }
}

export function openOrRecreateAiVectorDb(embeddingDim: number): Database.Database {
  if (db && openedDim === embeddingDim) return db;
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
    openedDim = 0;
  }

  mkdirSync(path.dirname(dbPath()), { recursive: true });

  const database = new Database(dbPath());
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  createBaseTables(database);
  database.loadExtension(resolveSqliteVecLoadPath());
  ensureVecLayer(database, embeddingDim);

  db = database;
  openedDim = embeddingDim;
  return database;
}

export function getAiVectorDb(): Database.Database {
  if (!db) throw new Error("AI vector DB not opened");
  return db;
}

/** 维度变更：清空向量索引与 chunks，保留会话表 */
export function resetEmbeddingDimension(newDim: number): void {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
    openedDim = 0;
  }

  mkdirSync(path.dirname(dbPath()), { recursive: true });

  const database = new Database(dbPath());
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  createBaseTables(database);
  database.loadExtension(resolveSqliteVecLoadPath());
  dropVecTables(database);
  createVecTables(database, newDim);

  db = database;
  openedDim = newDim;
}

export function indexHasBook(bookHash: string): boolean {
  const database = getAiVectorDb();
  const row = database
    .prepare(`SELECT 1 FROM chunks WHERE book_hash = ? LIMIT 1`)
    .get(bookHash);
  return Boolean(row);
}

export function deleteBookIndex(bookHash: string): void {
  const database = getAiVectorDb();
  const ids = database
    .prepare(`SELECT id FROM chunks WHERE book_hash = ?`)
    .all(bookHash) as { id: string }[];

  const tx = database.transaction(() => {
    for (const { id } of ids) {
      const r = database
        .prepare(`SELECT rowid FROM id_mapping WHERE chunk_id = ?`)
        .get(id) as { rowid: number } | undefined;
      if (r) {
        database.prepare(`DELETE FROM vec_embeddings WHERE rowid = ?`).run(r.rowid);
      }
      database.prepare(`DELETE FROM id_mapping WHERE chunk_id = ?`).run(id);
    }
    database.prepare(`DELETE FROM chunks WHERE book_hash = ?`).run(bookHash);
  });
  tx();
}

export function insertChunksBatch(records: AIChunkRecord[]): void {
  if (records.length === 0) return;
  const database = getAiVectorDb();
  const now = Date.now();
  const insChunk = database.prepare(`
    INSERT INTO chunks (id, book_hash, chapter_index, chapter_title, content, char_start, char_end, token_count, updated_at)
    VALUES (@id, @book_hash, @chapter_index, @chapter_title, @content, @char_start, @char_end, @token_count, @updated_at)
  `);
  const insMap = database.prepare(
    `INSERT INTO id_mapping (chunk_id, book_hash) VALUES (?, ?)`,
  );
  const insVec = database.prepare(
    `INSERT INTO vec_embeddings (rowid, embedding) VALUES (?, ?)`,
  );

  const tx = database.transaction(() => {
    for (const r of records) {
      insChunk.run({
        id: r.id,
        book_hash: r.bookHash,
        chapter_index: r.chapterIndex,
        chapter_title: r.chapterTitle,
        content: r.content,
        char_start: r.charStart,
        char_end: r.charEnd,
        token_count: r.tokenCount,
        updated_at: now,
      });
      const info = insMap.run(r.id, r.bookHash);
      const rowid = Number(info.lastInsertRowid);
      insVec.run(BigInt(rowid), new Float32Array(r.embedding));
    }
  });
  tx();
}

export function searchChunks(
  bookHash: string,
  queryEmbedding: number[],
  topK: number,
): AIIndexSearchHit[] {
  const database = getAiVectorDb();
  const q = new Float32Array(queryEmbedding);
  const rows = database
    .prepare(
      `
      SELECT m.chunk_id AS chunkId, v.distance AS distance
      FROM vec_embeddings v
      JOIN id_mapping m ON v.rowid = m.rowid
      WHERE v.embedding MATCH ? AND m.book_hash = ?
      ORDER BY v.distance
      LIMIT ?
    `,
    )
    .all(q, bookHash, topK) as { chunkId: string; distance: number }[];

  if (rows.length === 0) return [];

  const chunkStmt = database.prepare(
    `SELECT id, chapter_index, chapter_title, content, char_start, char_end FROM chunks WHERE id = ?`,
  );

  const hits: AIIndexSearchHit[] = [];
  for (const row of rows) {
    const c = chunkStmt.get(row.chunkId) as
      | {
          id: string;
          chapter_index: number;
          chapter_title: string;
          content: string;
          char_start: number;
          char_end: number;
        }
      | undefined;
    if (!c) continue;
    hits.push({
      chunkId: c.id,
      chapterIndex: c.chapter_index,
      chapterTitle: c.chapter_title,
      content: c.content,
      charStart: c.char_start,
      charEnd: c.char_end,
      distance: row.distance,
    });
  }
  return hits;
}

export function listThreads(bookHash: string) {
  const database = getAiVectorDb();
  return database
    .prepare(
      `SELECT id, book_hash AS bookHash, title, created_at AS createdAt, updated_at AS updatedAt
       FROM threads WHERE book_hash = ? ORDER BY updated_at DESC`,
    )
    .all(bookHash) as Array<{
      id: string;
      bookHash: string;
      title: string;
      createdAt: number;
      updatedAt: number;
    }>;
}

export function createThread(bookHash: string, title: string): string {
  const database = getAiVectorDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO threads (id, book_hash, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, bookHash, title, now, now);
  return id;
}

export function renameThread(threadId: string, title: string): void {
  const database = getAiVectorDb();
  database
    .prepare(`UPDATE threads SET title = ?, updated_at = ? WHERE id = ?`)
    .run(title, Date.now(), threadId);
}

export function touchThread(threadId: string): void {
  const database = getAiVectorDb();
  database
    .prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`)
    .run(Date.now(), threadId);
}

export function deleteThread(threadId: string): void {
  const database = getAiVectorDb();
  database.prepare(`DELETE FROM threads WHERE id = ?`).run(threadId);
}

export function listMessages(threadId: string) {
  const database = getAiVectorDb();
  return database
    .prepare(
      `SELECT id, thread_id AS threadId, role, content, created_at AS createdAt, aborted AS abortedNum
       FROM messages WHERE thread_id = ? ORDER BY created_at ASC`,
    )
    .all(threadId) as Array<{
      id: string;
      threadId: string;
      role: string;
      content: string;
      createdAt: number;
      abortedNum: number;
    }>;
}

export function appendMessage(
  threadId: string,
  role: "user" | "assistant" | "system",
  content: string,
  aborted = false,
): string {
  const database = getAiVectorDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO messages (id, thread_id, role, content, created_at, aborted) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, threadId, role, content, now, aborted ? 1 : 0);
  touchThread(threadId);
  return id;
}
