import { app } from "electron";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import {
  type AIConfig,
  defaultAIConfig,
  normalizeAiQuickQuestions,
  normalizeTxt2ImgConfig,
} from "@shared/aiTypes";

const CONFIG_REL = ["ai", "config.json"];

function configPath(): string {
  return path.join(app.getPath("userData"), ...CONFIG_REL);
}

/** IPC / 磁盘读取后的不完整对象也可合并为完整 AIConfig */
export function mergeAiConfigWithDefaults(raw: unknown): AIConfig {
  const base = structuredClone(defaultAIConfig);
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  if (o.chat && typeof o.chat === "object") {
    Object.assign(base.chat, o.chat as object);
  }
  if (o.embedding && typeof o.embedding === "object") {
    Object.assign(base.embedding, o.embedding as object);
  }
  if (typeof o.aiEnabled === "boolean") {
    base.aiEnabled = o.aiEnabled;
  }
  if (typeof o.embeddingEnabled === "boolean") {
    base.embeddingEnabled = o.embeddingEnabled;
  }
  for (const k of [
    "chunkTargetTokens",
    "chunkMinTokens",
    "chunkOverlapRatio",
    "ragTopK",
  ] as const) {
    if (typeof o[k] === "number" && Number.isFinite(o[k])) {
      (base as unknown as Record<string, number>)[k] = o[k] as number;
    }
  }
  base.quickQuestions = normalizeAiQuickQuestions(o.quickQuestions);
  base.txt2img = normalizeTxt2ImgConfig(o.txt2img);
  return base;
}

export async function loadAiConfig(): Promise<AIConfig> {
  try {
    const buf = await readFile(configPath(), "utf-8");
    return mergeAiConfigWithDefaults(JSON.parse(buf));
  } catch {
    return structuredClone(defaultAIConfig);
  }
}

export async function saveAiConfig(cfg: AIConfig): Promise<void> {
  const dir = path.dirname(configPath());
  await mkdir(dir, { recursive: true });
  const json = `${JSON.stringify(cfg, null, 2)}\n`;
  await writeFile(configPath(), json, "utf-8");
  try {
    await chmod(configPath(), 0o600);
  } catch {
    // Windows 等可能不支持
  }
}
