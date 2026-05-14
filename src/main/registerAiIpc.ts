import { dialog, ipcMain, type FileFilter } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AIAgentStartPayload,
  AIChunkRecord,
  AIChatStreamPayload,
  AIConfig,
  BookStyleInferResult,
  PortraitExtractResult,
} from "@shared/aiTypes";
import type { AiTxt2ImgInvokeResult } from "@shared/aiTxt2ImgIpc";
import {
  loadAiConfig,
  mergeAiConfigWithDefaults,
  saveAiConfig,
} from "./aiConfig";
import { embedTexts, probeEmbeddingDimension } from "./aiEmbedding";
import { runAgentChat } from "./aiAgentChat";
import { abortChatRequest, streamChatCompletion } from "./aiChat";
import {
  runBookStyleInference,
  runCharacterPortraitExtract,
  runPortraitPromptZhToEn,
  runTxt2ImgToAbsolutePath,
} from "./aiCharacterPortrait";
import {
  appendMessage,
  createThread,
  deleteBookIndex,
  deleteThread,
  deleteEmptyThreadsForBook,
  indexHasBook,
  insertChunksBatch,
  listMessages,
  listThreads,
  openOrRecreateAiVectorDb,
  renameThread,
  resetEmbeddingDimension,
  searchChunks,
} from "./aiVectorDb";

/** 角色「AI 检索」：同一会话的 extract + infer 共用 AbortSignal（renderer 传 retrieveSessionId） */
const portraitRetrieveSessionAbortById = new Map<number, AbortController>();

/** 侧栏「生成立绘」：单次 txt2imgToPath 会话，可由 renderer 调用 abort 中断 */
let portraitTxt2ImgSessionAc: AbortController | null = null;

function portraitRetrieveSessionAc(sid: number): AbortController {
  let ac = portraitRetrieveSessionAbortById.get(sid);
  if (!ac) {
    ac = new AbortController();
    portraitRetrieveSessionAbortById.set(sid, ac);
  }
  return ac;
}

function parseRetrieveSessionId(
  payloadRaw: Record<string, unknown>,
): number | undefined {
  const v = payloadRaw.retrieveSessionId;
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.trunc(v);
}

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

async function txt2imgListA1111SamplersAtBase(
  apiBaseUrl: string,
): Promise<
  { ok: true; samplers: string[] } | { ok: false; error: string }
> {
  try {
    const url = `${normalizeBase(apiBaseUrl)}/sdapi/v1/samplers`;
    const res = await fetch(url);
    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status}: ${raw.slice(0, 200)}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "返回非 JSON" };
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, error: "采样器列表格式无效" };
    }
    const names: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const name = (item as Record<string, unknown>).name;
      if (typeof name !== "string" || !name.trim()) continue;
      const t = name.trim();
      if (seen.has(t)) continue;
      seen.add(t);
      names.push(t);
    }
    names.sort((a, b) => a.localeCompare(b, "en"));
    return { ok: true, samplers: names };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function txt2imgListA1111UpscalersAtBase(
  apiBaseUrl: string,
): Promise<
  { ok: true; upscalers: string[] } | { ok: false; error: string }
> {
  try {
    const url = `${normalizeBase(apiBaseUrl)}/sdapi/v1/upscalers`;
    const res = await fetch(url);
    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status}: ${raw.slice(0, 200)}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "返回非 JSON" };
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, error: "放大算法列表格式无效" };
    }
    const names: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const nameRaw = rec.name;
      const modelNameRaw = rec.model_name;
      const name =
        typeof nameRaw === "string" ? nameRaw.trim() : "";
      const modelName =
        typeof modelNameRaw === "string" ? modelNameRaw.trim() : "";
      const t = name || modelName;
      if (!t || seen.has(t)) continue;
      seen.add(t);
      names.push(t);
    }
    names.sort((a, b) => a.localeCompare(b, "en"));
    return { ok: true, upscalers: names };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function txt2imgListA1111SdModelsAtBase(
  apiBaseUrl: string,
): Promise<
  { ok: true; sdModels: string[] } | { ok: false; error: string }
> {
  try {
    const url = `${normalizeBase(apiBaseUrl)}/sdapi/v1/sd-models`;
    const res = await fetch(url);
    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status}: ${raw.slice(0, 200)}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "返回非 JSON" };
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, error: "SD 模型列表格式无效" };
    }
    const titles: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const titleRaw = rec.title;
      const modelNameRaw = rec.model_name;
      const title =
        typeof titleRaw === "string" ? titleRaw.trim() : "";
      const modelName =
        typeof modelNameRaw === "string" ? modelNameRaw.trim() : "";
      const t = title || modelName;
      if (!t || seen.has(t)) continue;
      seen.add(t);
      titles.push(t);
    }
    titles.sort((a, b) => a.localeCompare(b, "en"));
    return { ok: true, sdModels: titles };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 文生图：设置里通用片段在前，角色侧栏片段在后，中文顿号衔接 */
function mergeTxt2ImgZhGeneralBeforeSpecific(
  general: string,
  specific: string,
): string {
  const g = general.trim();
  const s = specific.trim();
  if (!g) return s;
  if (!s) return g;
  return `${g}，${s}`;
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
        aiConfig: c,
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
    "ai:txt2img",
    async (_evt, draft: unknown): Promise<AiTxt2ImgInvokeResult> => {
      if (!isRecord(draft)) return { ok: false, error: "无效参数" };
      const op = typeof draft.op === "string" ? draft.op : "";
      const apiBaseUrl =
        typeof draft.apiBaseUrl === "string" ? draft.apiBaseUrl.trim() : "";
      if (!apiBaseUrl) {
        return { ok: false, error: "缺少文生图接口地址" };
      }
      if (op === "listA1111Samplers") {
        const r = await txt2imgListA1111SamplersAtBase(apiBaseUrl);
        if (!r.ok) return r;
        return { ok: true, op: "listA1111Samplers", samplers: r.samplers };
      }
      if (op === "listA1111Upscalers") {
        const r = await txt2imgListA1111UpscalersAtBase(apiBaseUrl);
        if (!r.ok) return r;
        return {
          ok: true,
          op: "listA1111Upscalers",
          upscalers: r.upscalers,
        };
      }
      if (op === "listA1111SdModels") {
        const r = await txt2imgListA1111SdModelsAtBase(apiBaseUrl);
        if (!r.ok) return r;
        return { ok: true, op: "listA1111SdModels", sdModels: r.sdModels };
      }
      return {
        ok: false,
        error: `未知文生图 op: ${op || "(空)"}`,
      };
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

  ipcMain.handle(
    "ai:thread:deleteEmptyForBook",
    async (_evt, bookHash: unknown, exceptThreadId?: unknown) => {
      const c = await cfg();
      openOrRecreateAiVectorDb(c.embedding.dimension);
      if (typeof bookHash !== "string") return;
      const keep =
        typeof exceptThreadId === "string" && exceptThreadId.length > 0
          ? exceptThreadId
          : undefined;
      deleteEmptyThreadsForBook(bookHash, keep);
    },
  );

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
    "ai:portrait:extract",
    async (
      _evt,
      payloadRaw: unknown,
    ): Promise<
      PortraitExtractResult | { error: string }
    > => {
      const c = await cfg();
      openOrRecreateAiVectorDb(c.embedding.dimension);
      if (!isRecord(payloadRaw)) return { error: "无效参数" };
      const bookHash = payloadRaw.bookHash;
      const characterName = payloadRaw.characterName;
      const spoilerSafe = payloadRaw.spoilerSafe === true;
      const activeChapterIdx = payloadRaw.activeChapterIdx;
      if (typeof bookHash !== "string" || typeof characterName !== "string") {
        return { error: "无效 bookHash 或角色名" };
      }
      const ch =
        typeof activeChapterIdx === "number" && Number.isFinite(activeChapterIdx)
          ? Math.trunc(activeChapterIdx)
          : -1;
      const retrieveSessionId = parseRetrieveSessionId(payloadRaw);
      const signal =
        retrieveSessionId != null
          ? portraitRetrieveSessionAc(retrieveSessionId).signal
          : undefined;
      return runCharacterPortraitExtract(c, {
        bookHash,
        characterName,
        spoilerSafe,
        activeChapterIdx: ch,
        signal,
      });
    },
  );

  ipcMain.handle(
    "ai:portrait:retrieve:abort",
    (_evt, sidRaw: unknown) => {
      if (typeof sidRaw !== "number" || !Number.isFinite(sidRaw)) {
        return { ok: false as const };
      }
      const sid = Math.trunc(sidRaw);
      const ac = portraitRetrieveSessionAbortById.get(sid);
      if (ac) {
        ac.abort();
        portraitRetrieveSessionAbortById.delete(sid);
      }
      return { ok: true as const };
    },
  );

  ipcMain.handle(
    "ai:portrait:retrieve:session:dispose",
    (_evt, sidRaw: unknown) => {
      if (typeof sidRaw !== "number" || !Number.isFinite(sidRaw)) {
        return { ok: false as const };
      }
      portraitRetrieveSessionAbortById.delete(Math.trunc(sidRaw));
      return { ok: true as const };
    },
  );

  ipcMain.handle(
    "ai:portrait:translateSdPrompt",
    async (
      _evt,
      payloadRaw: unknown,
    ): Promise<
      | { style_en: string; prompt_en: string; negative_en: string }
      | { error: string }
    > => {
      const c = await cfg();
      if (!isRecord(payloadRaw)) return { error: "无效参数" };
      const styleZh = payloadRaw.styleZh;
      const promptZh = payloadRaw.promptZh;
      const negativeZh = payloadRaw.negativeZh;
      if (typeof promptZh !== "string" || typeof negativeZh !== "string") {
        return { error: "无效 promptZh 或 negativeZh" };
      }
      return runPortraitPromptZhToEn(c, {
        styleZh: typeof styleZh === "string" ? styleZh : "",
        promptZh,
        negativeZh,
      });
    },
  );

  ipcMain.handle(
    "ai:portrait:inferStyle",
    async (
      _evt,
      payloadRaw: unknown,
    ): Promise<BookStyleInferResult | { error: string }> => {
      const c = await cfg();
      openOrRecreateAiVectorDb(c.embedding.dimension);
      if (!isRecord(payloadRaw)) return { error: "无效参数" };
      const bookHash = payloadRaw.bookHash;
      const fileTitle = payloadRaw.fileTitle;
      const spoilerSafe = payloadRaw.spoilerSafe === true;
      const activeChapterIdx = payloadRaw.activeChapterIdx;
      if (typeof bookHash !== "string") return { error: "无效 bookHash" };
      const title = typeof fileTitle === "string" ? fileTitle : "";
      const ch =
        typeof activeChapterIdx === "number" && Number.isFinite(activeChapterIdx)
          ? Math.trunc(activeChapterIdx)
          : -1;
      const retrieveSessionId = parseRetrieveSessionId(payloadRaw);
      const ac =
        retrieveSessionId != null
          ? portraitRetrieveSessionAbortById.get(retrieveSessionId)
          : undefined;
      try {
        return await runBookStyleInference(c, {
          bookHash,
          fileTitle: title,
          spoilerSafe,
          activeChapterIdx: ch,
          signal: ac?.signal,
        });
      } finally {
        if (retrieveSessionId != null) {
          portraitRetrieveSessionAbortById.delete(retrieveSessionId);
        }
      }
    },
  );

  ipcMain.handle(
    "ai:portrait:txt2imgToPath",
    async (
      _evt,
      payloadRaw: unknown,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      portraitTxt2ImgSessionAc?.abort();
      const ac = new AbortController();
      portraitTxt2ImgSessionAc = ac;
      try {
        const c = await cfg();
        if (!isRecord(payloadRaw)) return { ok: false, error: "无效参数" };
        const outputPath = payloadRaw.outputPath;
        const styleZh =
          typeof payloadRaw.styleZh === "string" ? payloadRaw.styleZh : "";
        const promptZh =
          typeof payloadRaw.promptZh === "string" ? payloadRaw.promptZh : "";
        const negativeZh =
          typeof payloadRaw.negativeZh === "string" ? payloadRaw.negativeZh : "";
        const mergedPromptZh = mergeTxt2ImgZhGeneralBeforeSpecific(
          c.txt2img.defaultPositivePrompt,
          promptZh,
        );
        const mergedNegativeZh = mergeTxt2ImgZhGeneralBeforeSpecific(
          c.txt2img.defaultNegativePrompt,
          negativeZh,
        );
        if (typeof outputPath !== "string" || !outputPath.trim()) {
          return { ok: false, error: "无效 outputPath" };
        }
        const tr = await runPortraitPromptZhToEn(c, {
          styleZh,
          promptZh: mergedPromptZh,
          negativeZh: mergedNegativeZh,
          signal: ac.signal,
        });
        if (ac.signal.aborted) {
          return { ok: false, error: "已停止" };
        }
        if ("error" in tr) {
          if (ac.signal.aborted) return { ok: false, error: "已停止" };
          return { ok: false, error: tr.error };
        }
        const finalPrompt = [tr.style_en, tr.prompt_en]
          .map((s) => s.trim())
          .filter(Boolean)
          .join(", ");
        if (!finalPrompt) {
          return {
            ok: false,
            error: "请填写画风、通用/角色正面提示词之一（或在设置中填写通用正面）",
          };
        }
        const neg = tr.negative_en.trim();
        return await runTxt2ImgToAbsolutePath({
          txt2img: c.txt2img,
          prompt: finalPrompt,
          negativePrompt: neg,
          outputPathAbsolute: outputPath.trim(),
          aiForTranslate: c,
          signal: ac.signal,
        });
      } finally {
        if (portraitTxt2ImgSessionAc === ac) portraitTxt2ImgSessionAc = null;
      }
    },
  );

  ipcMain.handle("ai:portrait:txt2imgToPath:abort", () => {
    portraitTxt2ImgSessionAc?.abort();
    return { ok: true as const };
  });

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
