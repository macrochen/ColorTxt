import { dialog, ipcMain, type FileFilter } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AIAgentStartPayload,
  AIChunkRecord,
  AIChatStreamPayload,
  AIConfig,
} from "@shared/aiTypes";
import {
  loadAiConfig,
  mergeAiConfigWithDefaults,
  saveAiConfig,
} from "./aiConfig";
import { embedTexts, probeEmbeddingDimension } from "./aiEmbedding";
import { runAgentChat } from "./aiAgentChat";
import { abortChatRequest, streamChatCompletion } from "./aiChat";
import {
  appendMessage,
  createThread,
  deleteBookIndex,
  deleteThread,
  indexHasBook,
  insertChunksBatch,
  listMessages,
  listThreads,
  openOrRecreateAiVectorDb,
  renameThread,
  resetEmbeddingDimension,
  searchChunks,
} from "./aiVectorDb";

let cachedConfig: AIConfig | null = null;

async function cfg(): Promise<AIConfig> {
  if (!cachedConfig) cachedConfig = await loadAiConfig();
  return cachedConfig;
}

function normalizeBase(u: string): string {
  return u.replace(/\/+$/, "");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object";
}

/** 与渲染进程一轮提问的 requestId 对齐，用于中止正在进行的 embedding fetch */
const embedAbortControllers = new Map<number, AbortController>();

function takeEmbedAbortController(requestId: number): AbortController {
  for (const id of [...embedAbortControllers.keys()]) {
    if (id !== requestId) embedAbortControllers.delete(id);
  }
  let ac = embedAbortControllers.get(requestId);
  if (!ac || ac.signal.aborted) {
    ac = new AbortController();
    embedAbortControllers.set(requestId, ac);
  }
  return ac;
}

export function registerAiIpcHandlers(): void {
  ipcMain.handle("ai:config:get", async () => {
    cachedConfig = await loadAiConfig();
    openOrRecreateAiVectorDb(cachedConfig.embedding.dimension);
    return cachedConfig;
  });

  ipcMain.handle(
    "ai:config:set",
    async (
      _evt,
      nextRaw: unknown,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!isRecord(nextRaw)) return { ok: false, error: "无效配置" };
      const prev = await loadAiConfig();
      const next = mergeAiConfigWithDefaults(nextRaw);
      const dimChanged = prev.embedding.dimension !== next.embedding.dimension;
      await saveAiConfig(next);
      cachedConfig = next;
      if (dimChanged) {
        resetEmbeddingDimension(next.embedding.dimension);
      } else {
        openOrRecreateAiVectorDb(next.embedding.dimension);
      }
      return { ok: true };
    },
  );

  ipcMain.handle(
    "ai:embedding:embed",
    async (_evt, texts: unknown, requestIdRaw: unknown) => {
      const c = await cfg();
      if (!c.embeddingEnabled) {
        throw new Error("向量模型未启用");
      }
      openOrRecreateAiVectorDb(c.embedding.dimension);
      if (!Array.isArray(texts)) throw new Error("参数须为字符串数组");
      const arr = texts.filter((x): x is string => typeof x === "string");
      const reqId =
        typeof requestIdRaw === "number" && Number.isFinite(requestIdRaw)
          ? requestIdRaw
          : undefined;
      const signal =
        reqId !== undefined
          ? takeEmbedAbortController(reqId).signal
          : undefined;
      return embedTexts(c.embedding, arr, signal);
    },
  );

  ipcMain.handle("ai:embedding:abort", (_evt, requestId: unknown) => {
    if (typeof requestId !== "number") return { ok: true as const };
    embedAbortControllers.get(requestId)?.abort();
    embedAbortControllers.delete(requestId);
    return { ok: true as const };
  });

  ipcMain.handle("ai:index:hasBook", async (_evt, bookHash: unknown) => {
    const c = await cfg();
    if (!c.embeddingEnabled) return false;
    openOrRecreateAiVectorDb(c.embedding.dimension);
    if (typeof bookHash !== "string") return false;
    return indexHasBook(bookHash);
  });

  ipcMain.handle(
    "ai:index:deleteBook",
    async (_evt, bookHash: unknown): Promise<{ ok: boolean }> => {
      const c = await cfg();
      openOrRecreateAiVectorDb(c.embedding.dimension);
      if (typeof bookHash !== "string") return { ok: false };
      deleteBookIndex(bookHash);
      return { ok: true };
    },
  );

  ipcMain.handle(
    "ai:index:replaceChunks",
    async (
      _evt,
      bookHash: unknown,
      recordsRaw: unknown,
    ): Promise<{ ok: boolean; error?: string }> => {
      const c = await cfg();
      if (!c.embeddingEnabled) {
        return { ok: false, error: "向量模型未启用" };
      }
      openOrRecreateAiVectorDb(c.embedding.dimension);
      if (typeof bookHash !== "string")
        return { ok: false, error: "无效 bookHash" };
      if (!Array.isArray(recordsRaw))
        return { ok: false, error: "无效 chunks" };

      const records: AIChunkRecord[] = [];
      for (const r of recordsRaw) {
        if (!isRecord(r)) continue;
        const emb = r.embedding;
        if (!Array.isArray(emb) || emb.some((x) => typeof x !== "number"))
          continue;
        records.push({
          id: String(r.id),
          bookHash: String(r.bookHash),
          chapterIndex: Number(r.chapterIndex),
          chapterTitle: String(r.chapterTitle),
          content: String(r.content),
          charStart: Number(r.charStart),
          charEnd: Number(r.charEnd),
          tokenCount: Number(r.tokenCount) || 0,
          embedding: emb as number[],
        });
      }

      try {
        deleteBookIndex(bookHash);
        insertChunksBatch(records);
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
      }
    },
  );

  ipcMain.handle(
    "ai:index:search",
    async (
      _evt,
      args: unknown,
    ): Promise<
      import("@shared/aiTypes").AIIndexSearchHit[] | { error: string }
    > => {
      const c = await cfg();
      if (!c.embeddingEnabled) return { error: "向量模型未启用" };
      openOrRecreateAiVectorDb(c.embedding.dimension);
      if (!isRecord(args)) return { error: "无效参数" };
      const bookHash = args.bookHash;
      const query = args.queryEmbedding;
      const topK = args.topK;
      if (typeof bookHash !== "string") return { error: "无效 bookHash" };
      if (!Array.isArray(query) || query.some((x) => typeof x !== "number"))
        return { error: "无效 queryEmbedding" };
      const k = typeof topK === "number" ? topK : c.ragTopK;
      try {
        return searchChunks(bookHash, query as number[], k);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  ipcMain.handle(
    "ai:chat:start",
    async (
      evt,
      payloadRaw: unknown,
    ): Promise<{ ok: boolean; error?: string }> => {
      const c = await cfg();
      openOrRecreateAiVectorDb(c.embedding.dimension);
      if (!isRecord(payloadRaw)) return { ok: false, error: "无效 payload" };
      const p = payloadRaw as unknown as AIChatStreamPayload;
      if (typeof p.requestId !== "number")
        return { ok: false, error: "无效 requestId" };
      if (!Array.isArray(p.messages))
        return { ok: false, error: "无效 messages" };

      void streamChatCompletion({
        chat: c.chat,
        payload: p,
        configSystemPromptExtra: c.chat.systemPromptExtra,
        webContents: evt.sender,
      });
      return { ok: true };
    },
  );

  ipcMain.handle("ai:chat:abort", (_evt, requestId: unknown) => {
    if (typeof requestId === "number") abortChatRequest(requestId);
    return { ok: true as const };
  });

  ipcMain.handle(
    "ai:agent:start",
    async (
      evt,
      payloadRaw: unknown,
    ): Promise<{ ok: boolean; error?: string }> => {
      const c = await cfg();
      openOrRecreateAiVectorDb(c.embedding.dimension);
      if (!isRecord(payloadRaw)) return { ok: false, error: "无效 payload" };
      const p = payloadRaw as unknown as AIAgentStartPayload;
      if (typeof p.requestId !== "number")
        return { ok: false, error: "无效 requestId" };
      if (typeof p.threadId !== "string")
        return { ok: false, error: "无效 threadId" };
      if (typeof p.bookHash !== "string")
        return { ok: false, error: "无效 bookHash" };
      if (typeof p.userText !== "string")
        return { ok: false, error: "无效 userText" };
      if (!isRecord(p.bookMeta)) return { ok: false, error: "无效 bookMeta" };
      if (typeof p.deepThinking !== "boolean")
        return { ok: false, error: "无效 deepThinking" };

      void runAgentChat({
        chat: c.chat,
        embedding: c.embedding,
        embeddingEnabled: c.embeddingEnabled,
        payload: p,
        configSystemPromptExtra: c.chat.systemPromptExtra,
        webContents: evt.sender,
        ragTopKDefault: c.ragTopK,
      });
      return { ok: true };
    },
  );

  ipcMain.handle(
    "ai:models:list",
    async (
      _evt,
      draft: unknown,
    ): Promise<
      { ok: true; models: string[] } | { ok: false; error: string }
    > => {
      if (!isRecord(draft)) return { ok: false, error: "无效参数" };
      const baseUrl = typeof draft.baseUrl === "string" ? draft.baseUrl : "";
      const apiKey = typeof draft.apiKey === "string" ? draft.apiKey : "";
      if (!baseUrl.trim()) return { ok: false, error: "缺少 baseUrl" };
      try {
        const url = `${normalizeBase(baseUrl)}/models`;
        const headers: Record<string, string> = {};
        if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 200)}` };
        }
        const json = (await res.json()) as { data?: Array<{ id?: string }> };
        const models = (json.data ?? [])
          .map((x) => x.id)
          .filter((x): x is string => typeof x === "string");
        return { ok: true, models };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle(
    "ai:test:chat",
    async (
      _evt,
      draft: unknown,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!isRecord(draft)) return { ok: false, error: "无效参数" };
      const baseUrl = typeof draft.baseUrl === "string" ? draft.baseUrl : "";
      const apiKey = typeof draft.apiKey === "string" ? draft.apiKey : "";
      const model = typeof draft.model === "string" ? draft.model : "";
      if (!baseUrl.trim() || !model.trim())
        return { ok: false, error: "缺少 baseUrl 或 model" };
      try {
        const url = `${normalizeBase(baseUrl)}/chat/completions`;
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "Reply with exactly: OK" }],
            max_tokens: 8,
          }),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 300)}` };
        }
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle(
    "ai:test:embedding",
    async (
      _evt,
      draft: unknown,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!isRecord(draft)) return { ok: false, error: "无效参数" };
      const baseUrl = typeof draft.baseUrl === "string" ? draft.baseUrl : "";
      const apiKey = typeof draft.apiKey === "string" ? draft.apiKey : "";
      const model = typeof draft.model === "string" ? draft.model : "";
      const dimension =
        typeof draft.dimension === "number" ? draft.dimension : 0;
      if (!baseUrl.trim() || !model.trim() || dimension <= 0)
        return { ok: false, error: "缺少参数" };
      try {
        await embedTexts(
          {
            baseUrl,
            apiKey,
            model,
            dimension,
          },
          ["ping"],
        );
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle(
    "ai:embedding:probeDimension",
    async (
      _evt,
      draft: unknown,
    ): Promise<
      { ok: true; dimension: number } | { ok: false; error: string }
    > => {
      if (!isRecord(draft)) return { ok: false, error: "无效参数" };
      const baseUrl = typeof draft.baseUrl === "string" ? draft.baseUrl : "";
      const apiKey = typeof draft.apiKey === "string" ? draft.apiKey : "";
      const model = typeof draft.model === "string" ? draft.model : "";
      if (!baseUrl.trim() || !model.trim()) {
        return { ok: false, error: "需要 Embedding Base URL 与模型" };
      }
      try {
        const dimension = await probeEmbeddingDimension({
          baseUrl,
          apiKey,
          model,
        });
        return { ok: true, dimension };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle("ai:thread:list", async (_evt, bookHash: unknown) => {
    const c = await cfg();
    openOrRecreateAiVectorDb(c.embedding.dimension);
    if (typeof bookHash !== "string") return [];
    return listThreads(bookHash);
  });

  ipcMain.handle(
    "ai:thread:create",
    async (_evt, bookHash: unknown, title: unknown) => {
      const c = await cfg();
      openOrRecreateAiVectorDb(c.embedding.dimension);
      if (typeof bookHash !== "string") throw new Error("bookHash");
      const t = typeof title === "string" ? title : "新对话";
      return createThread(bookHash, t);
    },
  );

  ipcMain.handle(
    "ai:thread:rename",
    async (_evt, threadId: unknown, title: unknown, userChosen: unknown) => {
      const c = await cfg();
      openOrRecreateAiVectorDb(c.embedding.dimension);
      if (typeof threadId !== "string" || typeof title !== "string") return;
      renameThread(threadId, title, userChosen === true);
    },
  );

  ipcMain.handle("ai:thread:delete", async (_evt, threadId: unknown) => {
    const c = await cfg();
    openOrRecreateAiVectorDb(c.embedding.dimension);
    if (typeof threadId !== "string") return;
    deleteThread(threadId);
  });

  ipcMain.handle("ai:message:list", async (_evt, threadId: unknown) => {
    const c = await cfg();
    openOrRecreateAiVectorDb(c.embedding.dimension);
    if (typeof threadId !== "string") return [];
    return listMessages(threadId).map((m) => ({
      id: m.id,
      threadId: m.threadId,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      aborted: m.abortedNum === 1,
      toolCallId: m.toolCallId,
      toolName: m.toolName,
      toolCallsJson: m.toolCallsJson,
      payload: m.payload,
    }));
  });

  ipcMain.handle(
    "ai:message:append",
    async (
      _evt,
      threadId: unknown,
      role: unknown,
      content: unknown,
      aborted?: unknown,
    ) => {
      const c = await cfg();
      openOrRecreateAiVectorDb(c.embedding.dimension);
      if (typeof threadId !== "string") throw new Error("threadId");
      if (role !== "user" && role !== "assistant" && role !== "system")
        throw new Error("role");
      if (typeof content !== "string") throw new Error("content");
      return appendMessage(threadId, role, content, aborted === true);
    },
  );

  ipcMain.handle(
    "ai:export:save",
    async (
      _evt,
      payload: unknown,
    ): Promise<
      | { ok: true; path: string }
      | { ok: false; cancelled: true }
      | { ok: false; error: string }
    > => {
      if (!isRecord(payload)) return { ok: false, error: "无效参数" };
      const defaultName =
        typeof payload.defaultName === "string"
          ? payload.defaultName
          : "export.md";
      const data = typeof payload.data === "string" ? payload.data : "";
      const filters =
        payload.filters &&
        Array.isArray(payload.filters) &&
        payload.filters.every(
          (f) =>
            isRecord(f) &&
            typeof f.name === "string" &&
            Array.isArray(f.extensions),
        )
          ? (payload.filters as FileFilter[])
          : [{ name: "Markdown", extensions: ["md"] }];

      const defaultPathRaw =
        typeof payload.defaultPath === "string"
          ? payload.defaultPath.trim()
          : "";
      /** 可选初始目录 + 文件名（通常为当前书籍所在目录） */
      const defaultPath =
        defaultPathRaw && path.isAbsolute(defaultPathRaw)
          ? defaultPathRaw
          : defaultName;

      const res = await dialog.showSaveDialog({
        defaultPath,
        filters,
      });
      if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
      try {
        await writeFile(res.filePath, data, "utf-8");
        return { ok: true, path: res.filePath };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );
}
