/** AI 功能共享类型（主进程 / preload / renderer 对齐） */

export interface AIChatEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  slidingWindowSize: number;
  systemPromptExtra: string;
}

export interface AIEmbeddingEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimension: number;
}

export interface AIConfig {
  chat: AIChatEndpoint;
  /** 关闭时不构建向量索引，Agent 不提供 ragSearch/ragContext */
  embeddingEnabled: boolean;
  embedding: AIEmbeddingEndpoint;
  chunkTargetTokens: number;
  chunkMinTokens: number;
  chunkOverlapRatio: number;
  ragTopK: number;
  /** 对话为空时「快速提问」条目（顺序展示）；条目为除去空白后的非空字符串 */
  quickQuestions: string[];
}

/** 内置默认快速提问（配置缺失或清空后回退） */
export const DEFAULT_AI_QUICK_QUESTIONS: readonly string[] = [
  "这章讲了什么",
  "本书的主角和重要配角",
];

/** 归一化磁盘 / IPC 传入的快速提问列表 */
export function normalizeAiQuickQuestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_AI_QUICK_QUESTIONS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const t = x.trim().slice(0, 500);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 24) break;
  }
  return out.length > 0 ? out : [...DEFAULT_AI_QUICK_QUESTIONS];
}

export interface AIChunkRecord {
  id: string;
  bookHash: string;
  chapterIndex: number;
  chapterTitle: string;
  content: string;
  charStart: number;
  charEnd: number;
  tokenCount: number;
  embedding: number[];
}

export interface AIThreadRecord {
  id: string;
  bookHash: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type AIMessageRole = "user" | "assistant" | "system" | "tool";

/** messages.payload：JSON，如 { reasoning?: string } */
export interface AIMessagePayload {
  reasoning?: string;
}

export interface AIMessageRecord {
  id: string;
  threadId: string;
  role: AIMessageRole;
  content: string;
  createdAt: number;
  aborted?: boolean;
  toolCallId?: string | null;
  toolName?: string | null;
  /** assistant 带 tool_calls 时序列化保存 */
  toolCallsJson?: string | null;
  payload?: string | null;
}

/** Agent 会话启动（阅读助手）；不含全书正文，本章内容通过 ragContext 等工具按需拉取 */
export interface AIAgentBookMeta {
  fileTitle: string;
  chapterCount: number;
  currentChapterIndex: number;
  currentChapterTitle: string;
  /** 当前视窗/阅读位置附近节选（约数百字），随每次提问刷新 */
  surroundingText?: string;
}

/** 注入 Agent 的已启用技能快照（与设置中启用项一致） */
export interface AIAgentEnabledSkill {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

export interface AIAgentStartPayload {
  requestId: number;
  threadId: string;
  bookHash: string;
  /** 本轮用户输入（尚未写入 DB 则由调用方写入） */
  userText: string;
  bookMeta: AIAgentBookMeta;
  deepThinking: boolean;
  /** 防剧透；建议显式传 `false`，勿省略（省略则视为关闭） */
  spoilerSafe?: boolean;
  chatModelOverride?: string;
  /** 默认用配置的 slidingWindowSize */
  slidingWindowSize?: number;
  /** 默认 8 */
  maxToolRounds?: number;
  /** 已启用技能（用于注册 getSkills 与各 skill_* 工具）；缺省视为空数组 */
  enabledSkills?: AIAgentEnabledSkill[];
}

/** OpenAI tool_calls 中单条（解析完成后） */
export interface AIChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** 下行事件：主进程 → 渲染进程 */
export type AIAgentRendererEvent =
  | { type: "reasoning_delta"; requestId: number; delta: string }
  | { type: "content_delta"; requestId: number; delta: string }
  | {
      type: "tool_executing";
      requestId: number;
      toolCallId: string;
      name: string;
      argsPreview: string;
    }
  | {
      type: "tool_result";
      requestId: number;
      toolCallId: string;
      name: string;
      ok: boolean;
      preview: string;
      full: string;
    }
  | { type: "round_end"; requestId: number }
  | { type: "done"; requestId: number }
  | { type: "error"; requestId: number; message: string };

/** Agent 工具 schema（OpenAI tools[].function 形态） */
export const AI_AGENT_TOOLS: Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> = [
  {
    type: "function",
    function: {
      name: "ragSearch",
      description:
        "按语义检索本书片段。返回每条含 chapterIndex（从 0 起；用户正文 `（ch=N）` 的 N **必须等于** chapterIndex）、chapterTitle 与 content。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "检索查询，描述要找的情节、人物、地点或原文线索",
          },
          topK: {
            type: "number",
            description: "返回条数上限，默认 5，最大 12",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ragContext",
      description:
        "读取某一章内连续分块正文（按阅读顺序拼接）。用户问「本章」时 chapterIndex 应使用系统提示「当前阅读章节」对应的索引（从 0 起）；展开 ragSearch 命中章节时须与该结果中的 chapterIndex 一致。对用户作答写 `（ch=N）` 时 **N = chapterIndex（从 0 起）**。mergedMarkdown 中的「第 K 章 · …」仅供阅读，勿把 K 当作 （ch=） 里的 N。",
      parameters: {
        type: "object",
        properties: {
          chapterIndex: {
            type: "number",
            description: "章节索引（从 0 开始）",
          },
          maxChars: {
            type: "number",
            description: "拼接正文最大字符数，默认 12000，上限 24000",
          },
          range: {
            type: "number",
            description:
              "可选：仅取该章内中间若干块周围各扩展 range 块（默认取全章顺序节选直至 maxChars）",
          },
        },
        required: ["chapterIndex"],
        additionalProperties: false,
      },
    },
  },
];

export interface AIIndexSearchHit {
  chunkId: string;
  chapterIndex: number;
  chapterTitle: string;
  content: string;
  charStart: number;
  charEnd: number;
  distance: number;
}

export interface AIChatStreamPayload {
  requestId: number;
  /** 不含 system；主进程会前置拼装 system */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** 设置里保存的附加 system 文案，由 IPC 调用方传入 */
  systemPromptExtra?: string;
  ragSnippets: Array<{
    chapterIndex: number;
    chapterTitle: string;
    content: string;
  }>;
  bookMeta: {
    fileTitle: string;
    chapterCount: number;
    currentChapterIndex: number;
    currentChapterTitle: string;
  };
  /**
   * 用户阅读位置所在章节正文（标题行至下一章前），与 `currentChapterPlainText` 一致；
   * 用于「本章讲什么」等与当前章强相关的问题，不限于向量检索命中。
   */
  currentChapterText?: string;
  deepThinking: boolean;
  /**
   * 为 true 时在系统提示中强化：勿透露当前阅读章节之后的剧情或结局向信息。
   */
  spoilerSafe?: boolean;
  /**
   * 若为非空字符串，则本次请求使用该模型 id，替代设置中保存的 `chat.model`（不写回配置）。
   */
  chatModelOverride?: string;
}

export const defaultAIConfig: AIConfig = {
  embeddingEnabled: false,
  chat: {
    baseUrl: "http://localhost:1234/v1",
    apiKey: "",
    model: "",
    temperature: 0.7,
    maxTokens: 4096,
    slidingWindowSize: 8,
    systemPromptExtra: "",
  },
  embedding: {
    baseUrl: "http://localhost:1234/v1",
    apiKey: "",
    model: "",
    dimension: 1536,
  },
  chunkTargetTokens: 300,
  chunkMinTokens: 50,
  chunkOverlapRatio: 0.2,
  ragTopK: 5,
  quickQuestions: [...DEFAULT_AI_QUICK_QUESTIONS],
};
