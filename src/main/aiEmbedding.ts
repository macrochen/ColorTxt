import type { AIEmbeddingEndpoint } from "@shared/aiTypes";

function normalizeBase(u: string): string {
  return u.replace(/\/+$/, "");
}

function isOllamaEmbedUrl(baseUrl: string): boolean {
  const u = baseUrl.trim().toLowerCase();
  return u.endsWith("/api/embed") || u.includes("/api/embed");
}

/** 仅依赖 URL / Key / 模型，不包含 dimension（用于探测向量长度） */
export type EmbeddingEndpointCore = Pick<
  AIEmbeddingEndpoint,
  "baseUrl" | "apiKey" | "model"
>;

/**
 * 单次嵌入请求，返回与 batch 等长的向量数组（OpenAI /v1/embeddings 或 Ollama /api/embed）。
 */
async function postEmbeddingOnce(
  endpoint: EmbeddingEndpointCore,
  batch: string[],
): Promise<number[][]> {
  if (batch.length === 0) return [];

  const base = normalizeBase(endpoint.baseUrl);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (endpoint.apiKey.trim()) {
    headers.Authorization = `Bearer ${endpoint.apiKey.trim()}`;
  }

  let body: unknown;
  let url: string;

  if (isOllamaEmbedUrl(base)) {
    url = base.includes("/api/embed") ? base : `${base}/api/embed`;
    body = { model: endpoint.model, input: batch };
  } else {
    url = `${base}/embeddings`;
    body = {
      model: endpoint.model,
      input: batch.length === 1 ? batch[0] : batch,
      encoding_format: "float",
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Embedding HTTP ${res.status}: ${t.slice(0, 400)}`);
  }

  const json = (await res.json()) as {
    data?: Array<{ embedding: number[] }>;
    embedding?: number[];
  };

  const out: number[][] = [];

  if (Array.isArray(json.data)) {
    for (const row of json.data) {
      out.push(row.embedding);
    }
  } else if (json.embedding) {
    out.push(json.embedding);
  } else {
    throw new Error("Embedding 响应格式无效");
  }

  if (out.length === 0) {
    throw new Error("Embedding 响应格式无效");
  }

  return out;
}

/**
 * 发送最短文本调用嵌入接口，根据返回向量的实际长度得到 dimension（与保存配置一致后再用于索引）。
 */
export async function probeEmbeddingDimension(
  endpoint: EmbeddingEndpointCore,
): Promise<number> {
  const vecs = await postEmbeddingOnce(endpoint, ["."]);
  const len = vecs[0]?.length ?? 0;
  if (len < 1) throw new Error("无法从响应解析向量维度");
  return len;
}

export async function embedTexts(
  endpoint: AIEmbeddingEndpoint,
  texts: string[],
): Promise<number[][]> {
  const batchSize = 20;
  const all: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const part = await postEmbeddingOnce(endpoint, batch);
    all.push(...part);
  }

  const dim = endpoint.dimension;
  for (const vec of all) {
    if (vec.length !== dim) {
      throw new Error(
        `向量维度 ${vec.length} 与配置 dimension=${dim} 不符`,
      );
    }
  }

  return all;
}
