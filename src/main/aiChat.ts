import type { WebContents } from "electron";
import type {
  AIChatEndpoint,
  AIChatStreamPayload,
} from "@shared/aiTypes";

function normalizeBase(u: string): string {
  return u.replace(/\/+$/, "");
}

const CURRENT_CHAPTER_IN_PROMPT_MAX = 72_000;

function buildSystemPrompt(
  payload: AIChatStreamPayload,
  configExtra: string,
): string {
  const { bookMeta, ragSnippets, deepThinking, spoilerSafe } = payload;
  const lines: string[] = [
    "你是资深中文小说阅读助手，正在与用户讨论一部长篇作品。",
    "你必须严格依据下方「书籍信息」「当前章节正文」「相关片段」与对话中的用户问题作答。",
    "禁止编造原文未出现的情节、对白、人名或设定；材料不足时请直接说明缺什么信息，不要臆测补全。",
    "用户说「本章」「这一章」「当前章」时，默认指「当前章节正文」一节中的内容（若有）；回答宜紧扣剧情、人物与伏笔，条理清晰，可适度分点。",
    "",
    "## 书籍信息",
    `- 书名：${bookMeta.fileTitle}`,
    `- 总章节数：${bookMeta.chapterCount}`,
    `- 当前阅读章节：${
      bookMeta.currentChapterIndex >= 0
        ? `第 ${bookMeta.currentChapterIndex + 1} 章 · ${bookMeta.currentChapterTitle || "（无标题）"}`
        : bookMeta.currentChapterTitle || "（未能解析章节）"
    }`,
    "",
  ];

  const chapterRaw = (payload.currentChapterText ?? "").trim();
  if (chapterRaw) {
    const body =
      chapterRaw.length > CURRENT_CHAPTER_IN_PROMPT_MAX
        ? `${chapterRaw.slice(0, CURRENT_CHAPTER_IN_PROMPT_MAX)}\n\n…（本章正文过长，此处已截断；未展示部分请勿臆测）`
        : chapterRaw;
    lines.push(
      "## 当前章节正文（用户阅读光标所在章，含章节标题行起至下一章之前）",
      "概括本章、分析本章情节或人物时，请优先依据本节正文；可与「相关片段」交叉印证。",
      "",
      body,
      "",
    );
  }

  if (deepThinking) {
    lines.push("请先简要列出依据的关键情节线索，再给出结论。", "");
  }

  if (spoilerSafe) {
    lines.push(
      "## 防剧透",
      "用户已开启防剧透：回答时不要透露当前阅读章节之后的剧情发展、伏笔回收、人物命运或结局向信息。",
      "若用户问题明显涉及后文，请说明需读到对应进度再讨论，或仅依据已给出的「当前章节正文」与「相关片段」作答，不要臆测后文。",
      "",
    );
  }

  if (ragSnippets.length > 0) {
    lines.push("## 相关片段（向量检索，按相似度排序；未必覆盖本章全貌）");
    lines.push(
      "引用时请使用格式 (ch=N) 标注章节序号 N（从 1 开始计）。",
      "",
    );
    for (const s of ragSnippets) {
      const snippet =
        s.content.length > 600 ? `${s.content.slice(0, 600)}…` : s.content;
      lines.push(
        `[ch=${s.chapterIndex + 1}] ${s.chapterTitle}`,
        snippet,
        "",
      );
    }
  }

  const extra = (payload.systemPromptExtra ?? "").trim() || configExtra.trim();
  if (extra) {
    lines.push("## 用户在设置中附加的说明", extra, "");
  }

  return lines.join("\n");
}

function trimMessages(
  msgs: Array<{ role: "user" | "assistant"; content: string }>,
  slidingWindowSize: number,
): Array<{ role: "user" | "assistant"; content: string }> {
  if (slidingWindowSize <= 0) return msgs;
  const maxMsgs = Math.max(2, slidingWindowSize * 2);
  return msgs.length <= maxMsgs ? msgs : msgs.slice(-maxMsgs);
}

const chatAbortControllers = new Map<number, AbortController>();

export function abortChatRequest(requestId: number): void {
  const ac = chatAbortControllers.get(requestId);
  ac?.abort();
  chatAbortControllers.delete(requestId);
}

export async function streamChatCompletion(opts: {
  chat: AIChatEndpoint;
  payload: AIChatStreamPayload;
  configSystemPromptExtra: string;
  webContents: WebContents;
}): Promise<void> {
  const { chat, payload, webContents, configSystemPromptExtra } = opts;
  const requestId = payload.requestId;
  const url = `${normalizeBase(chat.baseUrl)}/chat/completions`;

  const windowed = trimMessages(payload.messages, chat.slidingWindowSize);

  const messages: Array<{ role: string; content: string }> = [
    {
      role: "system",
      content: buildSystemPrompt(payload, configSystemPromptExtra),
    },
    ...windowed.map((m) => ({ role: m.role, content: m.content })),
  ];

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (chat.apiKey.trim()) {
    headers.Authorization = `Bearer ${chat.apiKey.trim()}`;
  }

  const ac = new AbortController();
  chatAbortControllers.set(requestId, ac);

  const resolvedModel =
    (payload.chatModelOverride ?? "").trim() || chat.model.trim();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: ac.signal,
      body: JSON.stringify({
        model: resolvedModel,
        messages,
        temperature: chat.temperature,
        max_tokens: chat.maxTokens,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => "");
      webContents.send("ai:chat:error", {
        requestId,
        message: `HTTP ${res.status}: ${t.slice(0, 400)}`,
      });
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";

      for (const block of parts) {
        const line = block.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice("data:".length).trim();
        if (data === "[DONE]") {
          webContents.send("ai:chat:done", { requestId });
          return;
        }
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            webContents.send("ai:chat:chunk", { requestId, delta });
          }
        } catch {
          // 忽略半包 JSON
        }
      }
    }

    webContents.send("ai:chat:done", { requestId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("abort")) {
      webContents.send("ai:chat:done", { requestId });
      return;
    }
    webContents.send("ai:chat:error", { requestId, message: msg });
  } finally {
    chatAbortControllers.delete(requestId);
  }
}
