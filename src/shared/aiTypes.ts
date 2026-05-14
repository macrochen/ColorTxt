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

/** 文生图 HTTP 后端种类 */
export type AITxt2ImgBackend = "a1111" | "comfyui";

/** Stable Diffusion WebUI（AUTOMATIC1111）txt2img HTTP API 配置 */
export interface AITxt2ImgConfig {
  enabled: boolean;
  /** a1111：WebUI txt2img；comfyui：队列 `/prompt` + 轮询 `/history` */
  backend: AITxt2ImgBackend;
  /** 如 http://127.0.0.1:7860（A1111）或 http://127.0.0.1:8188（ComfyUI），不含路径 */
  apiBaseUrl: string;
  /**
   * ComfyUI「保存（API 格式）」工作流 JSON。
   * 在节点的文本/数值字段中可使用占位符（会被替换为合法 JSON 字符串片段）：
   * __PROMPT__、__NEGATIVE__、__SEED__、__WIDTH__、__HEIGHT__、__STEPS__、__CFG__
   */
  comfyWorkflowJson: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  /** 空字符串表示交由 WebUI 默认采样器 */
  samplerName: string;
  /**
   * A1111 仅：`GET /sdapi/v1/sd-models` 返回项的 `title`（与 WebUI 下拉一致），
   * 写入 txt2img 的 `override_settings.sd_model_checkpoint`，且不恢复为请求前 checkpoint，
   * WebUI 将保持为该模型直至别处切换；空字符串表示不覆盖，使用 WebUI 当前已选模型。
   */
  sdCheckpointTitle: string;
  /**
   * 通用正面提示词（建议中文）；侧栏生成立绘时自动拼在「角色正面」之前参与译英，
   * 再与画风前缀一并送入 SD。
   */
  defaultPositivePrompt: string;
  /** 默认负面提示词（建议中文编辑）；侧栏生成立绘时自动拼在「角色负面」之前参与译英 */
  defaultNegativePrompt: string;
  /** -1 表示每次随机 seed */
  seed: number;
  /**
   * A1111 仅：高分辨率修复（Hires. fix），对应 API `enable_hr` 等字段。
   * ComfyUI 后端忽略，请在 Comfy 工作流中自行配置放大。
   */
  hiresEnabled: boolean;
  /** 放大倍数，对应 `hr_scale` */
  hiresScale: number;
  /** 放大算法名称，对应 `hr_upscaler`（如 Latent、R-ESRGAN 4x+ Anime6B） */
  hiresUpscaler: string;
  /** 高分阶段迭代步数，对应 `hr_second_pass_steps`；0 表示由 WebUI 默认 */
  hiresSecondPassSteps: number;
  /** 重绘幅度，对应 `denoising_strength`（0～1） */
  hiresDenoisingStrength: number;
  /** 将宽度调整为，对应 `hr_resize_x`；0 表示按倍数由宽高推导 */
  hiresResizeX: number;
  /** 将高度调整为，对应 `hr_resize_y`；0 表示按倍数由宽高推导 */
  hiresResizeY: number;
}

/** 旧版内置英文默认负面词；载入配置时若仍为该串则替换为 {@link DEFAULT_NEGATIVE_PROMPT_ZH} */
export const LEGACY_TXT2IMG_DEFAULT_NEGATIVE_EN =
  "lowres, bad anatomy, bad hands, text, error, cropped, worst quality, low quality, jpeg artifacts, ugly, duplicate";

/** 文生图设置中展示的默认通用正面提示词（中文）；提交 SD 前主进程会译成英文 tag */
export const DEFAULT_POSITIVE_PROMPT_ZH =
  "最高画质，精细刻画，杰作，柔和光照，自然肤色，正常比例，构图稳定，单人，立绘，清晰线条";

/** 文生图设置中展示的默认通用负面提示词（中文）；提交 SD 前主进程会译成英文 tag */
export const DEFAULT_NEGATIVE_PROMPT_ZH =
  "低分辨率，形体崩坏，手部畸形，画面内文字，错误，裁切过度，最差画质，低画质，JPEG 块状压缩瑕疵，丑陋，重复元素";

export const defaultTxt2ImgConfig: AITxt2ImgConfig = {
  /** 默认开启侧栏「角色」入口；可在设置 → 文生图中关闭 */
  enabled: true,
  backend: "a1111",
  apiBaseUrl: "http://127.0.0.1:7860",
  comfyWorkflowJson: "",
  width: 512,
  height: 768,
  steps: 28,
  cfgScale: 7,
  samplerName: "",
  sdCheckpointTitle: "",
  defaultPositivePrompt: DEFAULT_POSITIVE_PROMPT_ZH,
  defaultNegativePrompt: DEFAULT_NEGATIVE_PROMPT_ZH,
  seed: -1,
  hiresEnabled: false,
  hiresScale: 2,
  hiresUpscaler: "Latent",
  hiresSecondPassSteps: 0,
  hiresDenoisingStrength: 0.7,
  hiresResizeX: 0,
  hiresResizeY: 0,
};

export function normalizeTxt2ImgConfig(raw: unknown): AITxt2ImgConfig {
  const d = structuredClone(defaultTxt2ImgConfig);
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  if (typeof o.enabled === "boolean") d.enabled = o.enabled;
  if (o.backend === "a1111" || o.backend === "comfyui") d.backend = o.backend;
  if (typeof o.apiBaseUrl === "string") d.apiBaseUrl = o.apiBaseUrl;
  if (typeof o.comfyWorkflowJson === "string") {
    const w = o.comfyWorkflowJson;
    d.comfyWorkflowJson = w.length > 400_000 ? w.slice(0, 400_000) : w;
  }
  for (const key of ["width", "height", "steps", "cfgScale", "seed"] as const) {
    const n = o[key];
    if (typeof n === "number" && Number.isFinite(n)) d[key] = Math.trunc(n);
  }
  if (typeof o.samplerName === "string") d.samplerName = o.samplerName;
  if (typeof o.sdCheckpointTitle === "string") {
    const t = o.sdCheckpointTitle.trim();
    d.sdCheckpointTitle = t.length > 512 ? t.slice(0, 512) : t;
  }
  if (typeof o.defaultPositivePrompt === "string") {
    d.defaultPositivePrompt = o.defaultPositivePrompt;
  }
  if (typeof o.defaultNegativePrompt === "string") {
    d.defaultNegativePrompt = o.defaultNegativePrompt;
    if (d.defaultNegativePrompt.trim() === LEGACY_TXT2IMG_DEFAULT_NEGATIVE_EN) {
      d.defaultNegativePrompt = DEFAULT_NEGATIVE_PROMPT_ZH;
    }
  }
  if (typeof o.hiresEnabled === "boolean") d.hiresEnabled = o.hiresEnabled;
  if (typeof o.hiresScale === "number" && Number.isFinite(o.hiresScale)) {
    d.hiresScale = Math.min(8, Math.max(1, o.hiresScale));
  }
  if (typeof o.hiresUpscaler === "string") {
    const u = o.hiresUpscaler.trim();
    d.hiresUpscaler = u.length > 120 ? u.slice(0, 120) : u || d.hiresUpscaler;
  }
  if (
    typeof o.hiresSecondPassSteps === "number" &&
    Number.isFinite(o.hiresSecondPassSteps)
  ) {
    d.hiresSecondPassSteps = Math.min(
      150,
      Math.max(0, Math.floor(o.hiresSecondPassSteps)),
    );
  }
  if (
    typeof o.hiresDenoisingStrength === "number" &&
    Number.isFinite(o.hiresDenoisingStrength)
  ) {
    d.hiresDenoisingStrength = Math.min(
      1,
      Math.max(0, o.hiresDenoisingStrength),
    );
  }
  for (const key of ["hiresResizeX", "hiresResizeY"] as const) {
    const n = o[key];
    if (typeof n === "number" && Number.isFinite(n)) {
      d[key] = Math.min(8192, Math.max(0, Math.floor(n)));
    }
  }
  return d;
}

/** 角色立绘：模型输出的单条原文摘录 */
export interface PortraitExtractExcerpt {
  chapterIndex: number;
  chapterTitle: string;
  quote: string;
}

/** 角色立绘：摘录 + SD 提示词（主进程校验后返回渲染进程） */
export type PortraitCharacterGender = "male" | "female" | "unknown";

export interface PortraitExtractResult {
  excerpts: PortraitExtractExcerpt[];
  appearance_zh: string;
  /** 侧栏展示与编辑的中文 SD 正面提示（逗号、顿号或短句均可）；提交 SD 前会译为英文 */
  sd_prompt_zh: string;
  /** 中文负面提示；空字符串表示文生图时使用设置中的默认负面词（可为中文，提交 SD 前译英） */
  negative_zh: string;
  confidence_note: string;
  /** 模型归纳的性别；缺省为 unknown */
  gender: PortraitCharacterGender;
  /** 年龄或年纪描述（如「少年」）；可空 */
  age_text: string;
  /** 身份/职业/社会地位 */
  identity_zh: string;
  /** 人物简介 */
  bio_zh: string;
  /** 主要人物关系 */
  relations_zh: string;
}

/** 侧栏「角色」推断全书画风（中文 SD 前缀草案 + 中文说明；提交 SD 前与角色 prompt 一并译英） */
export interface BookStyleInferResult {
  style_sd_prefix_zh: string;
  note_zh: string;
}

export interface AIConfig {
  /**
   * 总开关：关闭后侧栏隐藏「AI 阅读助手」，设置中不展示向量模型 / 文生图 / 技能标签。
   * 不影响磁盘已保存的向量索引与各子项配置。
   */
  aiEnabled: boolean;
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
  txt2img: AITxt2ImgConfig;
}

/** 内置默认快速提问（配置缺失或清空后回退） */
export const DEFAULT_AI_QUICK_QUESTIONS: readonly string[] = [
  "这章讲了什么",
  "本书的主角与重要配角都有谁",
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
  {
    type: "function",
    function: {
      name: "extractCharacterAppearance",
      description:
        "从本书向量检索某角色的外貌相关描写，并生成结构化摘录与 Stable Diffusion 用中文 prompt 草案（与侧栏「角色」面板同源；侧栏提交 SD 时会自动译为英文）。用户询问角色长什么样、衣着、画像参考时使用；结果 JSON 含 excerpts、appearance_zh、sd_prompt_zh、negative_zh、confidence_note，以及 gender、age_text、identity_zh、bio_zh、relations_zh 等归纳字段。须向量索引已启用。防剧透模式下仅含当前阅读章节及之前的片段。",
      parameters: {
        type: "object",
        properties: {
          reasoning: {
            type: "string",
            description: "简要说明为何调用本工具",
          },
          characterName: {
            type: "string",
            description: "要摘录外貌的角色名或常用称呼（中文为主）",
          },
        },
        required: ["reasoning", "characterName"],
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
  aiEnabled: true,
  embeddingEnabled: false,
  chat: {
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKey: "",
    model: "",
    temperature: 0.7,
    maxTokens: 4096,
    slidingWindowSize: 8,
    systemPromptExtra: "",
  },
  embedding: {
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKey: "",
    model: "",
    dimension: 1536,
  },
  chunkTargetTokens: 300,
  chunkMinTokens: 50,
  chunkOverlapRatio: 0.2,
  ragTopK: 5,
  quickQuestions: [...DEFAULT_AI_QUICK_QUESTIONS],
  txt2img: structuredClone(defaultTxt2ImgConfig),
};
