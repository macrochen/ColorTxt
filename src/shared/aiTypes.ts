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
  embedding: AIEmbeddingEndpoint;
  chunkTargetTokens: number;
  chunkMinTokens: number;
  chunkOverlapRatio: number;
  ragTopK: number;
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

export interface AIMessageRecord {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  aborted?: boolean;
}

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
   * 用户阅读位置所在章节正文（标题行至下一章前），与扩展 `getCurrentChapterText` 同源逻辑；
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
};
