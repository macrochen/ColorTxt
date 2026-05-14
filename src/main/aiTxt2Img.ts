import type { AITxt2ImgConfig } from "@shared/aiTypes";

/** AUTOMATIC1111 WebUI 标准 txt2img 端点（相对 apiBaseUrl） */
const A1111_TXT2IMG_HTTP_PATH = "/sdapi/v1/txt2img";
/** ComfyUI 提交队列端点（相对 apiBaseUrl）；历史与取图仍用官方 `/history`、`/view` */
const COMFYUI_PROMPT_HTTP_PATH = "/prompt";

function normalizeBase(u: string): string {
  return u.replace(/\/+$/, "");
}

/** JSON 字符串值内部的转义（不含外层引号） */
function escapeJsonStrInner(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

async function fetchA1111ImageBuffer(
  txt2img: AITxt2ImgConfig,
  prompt: string,
  negativePrompt: string,
  signal?: AbortSignal,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const base = normalizeBase(txt2img.apiBaseUrl.trim());
  if (!base) return { ok: false, error: "txt2img.apiBaseUrl 为空" };

  const url = `${base}${A1111_TXT2IMG_HTTP_PATH}`;

  const body: Record<string, unknown> = {
    prompt: prompt.trim(),
    negative_prompt: negativePrompt.trim(),
    steps: txt2img.steps,
    width: txt2img.width,
    height: txt2img.height,
    cfg_scale: txt2img.cfgScale,
  };

  const seed =
    typeof txt2img.seed === "number" && Number.isFinite(txt2img.seed)
      ? txt2img.seed
      : -1;
  if (seed >= 0) body.seed = seed;

  const sampler = txt2img.samplerName.trim();
  if (sampler) body.sampler_name = sampler;

  const ckpt = txt2img.sdCheckpointTitle.trim();
  if (ckpt) {
    body.override_settings = { sd_model_checkpoint: ckpt };
    body.override_settings_restore_afterwards = false;
  }

  if (txt2img.hiresEnabled) {
    body.enable_hr = true;
    body.hr_scale = txt2img.hiresScale;
    body.hr_upscaler = txt2img.hiresUpscaler.trim() || "Latent";
    body.hr_second_pass_steps = txt2img.hiresSecondPassSteps;
    body.denoising_strength = txt2img.hiresDenoisingStrength;
    body.hr_resize_x = txt2img.hiresResizeX;
    body.hr_resize_y = txt2img.hiresResizeY;
  } else {
    body.enable_hr = false;
  }

  let json: unknown;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        error: `文生图 HTTP ${res.status}: ${raw.slice(0, 400)}`,
      };
    }
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, error: "文生图接口返回非 JSON" };
    }
  } catch (e) {
    return { ok: false, error: errorFromTxt2ImgCatch(e) };
  }

  if (!json || typeof json !== "object") {
    return { ok: false, error: "文生图响应无效" };
  }
  const images = (json as Record<string, unknown>).images;
  if (!Array.isArray(images) || typeof images[0] !== "string") {
    return { ok: false, error: "文生图响应中缺少 images[0] base64" };
  }

  try {
    const buf = Buffer.from(images[0], "base64");
    if (buf.length < 32) return { ok: false, error: "解码后的图片过小" };
    return { ok: true, buffer: buf };
  } catch {
    return { ok: false, error: "无法解码返回的图片 base64" };
  }
}

function extractFirstOutputImage(meta: unknown): {
  filename: string;
  subfolder: string;
  type: string;
} | null {
  if (!meta || typeof meta !== "object") return null;
  const outputs = (meta as Record<string, unknown>).outputs;
  if (!outputs || typeof outputs !== "object") return null;
  for (const nodeOut of Object.values(outputs as Record<string, unknown>)) {
    if (!nodeOut || typeof nodeOut !== "object") continue;
    const images = (nodeOut as Record<string, unknown>).images;
    if (!Array.isArray(images) || images.length === 0) continue;
    const im = images[0];
    if (!im || typeof im !== "object") continue;
    const fn = (im as Record<string, unknown>).filename;
    if (typeof fn !== "string" || !fn.trim()) continue;
    const subfolderRaw = (im as Record<string, unknown>).subfolder;
    const typeRaw = (im as Record<string, unknown>).type;
    return {
      filename: fn.trim(),
      subfolder:
        typeof subfolderRaw === "string" ? subfolderRaw.trim() : "",
      type:
        typeof typeRaw === "string" && typeRaw.trim()
          ? typeRaw.trim()
          : "output",
    };
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isFetchAborted(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

function errorFromTxt2ImgCatch(e: unknown): string {
  if (isFetchAborted(e)) return "已停止";
  return e instanceof Error ? e.message : String(e);
}

/** 可被 AbortSignal 打断的延迟（用于 ComfyUI 轮询） */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchComfyUIImageBuffer(
  txt2img: AITxt2ImgConfig,
  prompt: string,
  negativePrompt: string,
  signal?: AbortSignal,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const template = txt2img.comfyWorkflowJson.trim();
  if (!template) {
    return {
      ok: false,
      error:
        "ComfyUI 需在设置中粘贴「保存（API 格式）」工作流 JSON，并在文本字段中使用 __PROMPT__、__NEGATIVE__ 等占位符。",
    };
  }

  const base = normalizeBase(txt2img.apiBaseUrl.trim());
  if (!base) return { ok: false, error: "txt2img.apiBaseUrl 为空" };

  const seedNum =
    typeof txt2img.seed === "number" && Number.isFinite(txt2img.seed)
      ? txt2img.seed
      : -1;
  const resolvedSeed =
    seedNum >= 0 ? Math.floor(seedNum) : Math.floor(Math.random() * 2_147_483_647);

  let workflowStr = template
    .replace(/__PROMPT__/g, escapeJsonStrInner(prompt.trim()))
    .replace(/__NEGATIVE__/g, escapeJsonStrInner(negativePrompt.trim()))
    .replace(/__SEED__/g, String(resolvedSeed))
    .replace(/__WIDTH__/g, String(txt2img.width))
    .replace(/__HEIGHT__/g, String(txt2img.height))
    .replace(/__STEPS__/g, String(txt2img.steps))
    .replace(/__CFG__/g, String(txt2img.cfgScale));

  let workflow: unknown;
  try {
    workflow = JSON.parse(workflowStr) as unknown;
  } catch {
    return {
      ok: false,
      error:
        "ComfyUI 工作流 JSON 解析失败。请确认占位符替换后仍为合法 JSON（若 prompt 中含引号需放在 __PROMPT__ 占位处）。",
    };
  }

  const queueUrl = `${base}${COMFYUI_PROMPT_HTTP_PATH}`;
  const clientId = `colortxt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  let promptId: string;
  try {
    const qRes = await fetch(queueUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: workflow,
        client_id: clientId,
      }),
      signal,
    });
    const qRaw = await qRes.text().catch(() => "");
    if (!qRes.ok) {
      return {
        ok: false,
        error: `ComfyUI 队列 HTTP ${qRes.status}: ${qRaw.slice(0, 400)}`,
      };
    }
    let qJson: unknown;
    try {
      qJson = JSON.parse(qRaw) as unknown;
    } catch {
      return { ok: false, error: "ComfyUI 队列返回非 JSON" };
    }
    const pid =
      qJson &&
      typeof qJson === "object" &&
      typeof (qJson as Record<string, unknown>).prompt_id === "string"
        ? String((qJson as Record<string, unknown>).prompt_id).trim()
        : "";
    if (!pid) {
      return {
        ok: false,
        error: `ComfyUI 未返回 prompt_id：${qRaw.slice(0, 300)}`,
      };
    }
    promptId = pid;
  } catch (e) {
    return { ok: false, error: errorFromTxt2ImgCatch(e) };
  }

  const histUrl = `${base}/history/${encodeURIComponent(promptId)}`;
  let imageRef: { filename: string; subfolder: string; type: string } | null =
    null;

  for (let i = 0; i < 140; i++) {
    try {
      await sleepAbortable(450, signal);
    } catch (e) {
      return { ok: false, error: errorFromTxt2ImgCatch(e) };
    }
    try {
      const hRes = await fetch(histUrl, { signal });
      const hRaw = await hRes.text().catch(() => "");
      if (!hRes.ok) continue;
      let hJson: unknown;
      try {
        hJson = JSON.parse(hRaw) as unknown;
      } catch {
        continue;
      }
      const entry =
        hJson &&
        typeof hJson === "object" &&
        (hJson as Record<string, unknown>)[promptId];
      imageRef = extractFirstOutputImage(entry);
      if (imageRef) break;
      const status =
        entry &&
        typeof entry === "object" &&
        (entry as Record<string, unknown>).status;
      const completed =
        status &&
        typeof status === "object" &&
        (status as Record<string, unknown>).completed === false;
      if (completed === false) continue;
    } catch (e) {
      if (isFetchAborted(e)) {
        return { ok: false, error: "已停止" };
      }
      /* 下一轮 */
    }
  }

  if (!imageRef) {
    return {
      ok: false,
      error:
        "ComfyUI 在等待时间内未完成或无图像输出。请检查工作流是否包含 SaveImage / Preview 等输出节点，或增大服务端超时。",
    };
  }

  const qs = new URLSearchParams({
    filename: imageRef.filename,
    subfolder: imageRef.subfolder,
    type: imageRef.type,
  });
  const viewUrl = `${base}/view?${qs.toString()}`;

  try {
    const vRes = await fetch(viewUrl, { signal });
    if (!vRes.ok) {
      const t = await vRes.text().catch(() => "");
      return {
        ok: false,
        error: `读取 ComfyUI 输出图 HTTP ${vRes.status}: ${t.slice(0, 200)}`,
      };
    }
    const arr = await vRes.arrayBuffer();
    const buf = Buffer.from(arr);
    if (buf.length < 32) return { ok: false, error: "ComfyUI 输出图过小" };
    return { ok: true, buffer: buf };
  } catch (e) {
    return { ok: false, error: errorFromTxt2ImgCatch(e) };
  }
}

/** 从配置的后端拉取一张 PNG 位图（A1111 base64 或 ComfyUI /view） */
export async function fetchTxt2ImgImageBuffer(
  txt2img: AITxt2ImgConfig,
  prompt: string,
  negativePrompt: string,
  signal?: AbortSignal,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const backend = txt2img.backend ?? "a1111";
  if (backend === "comfyui") {
    return fetchComfyUIImageBuffer(txt2img, prompt, negativePrompt, signal);
  }
  return fetchA1111ImageBuffer(txt2img, prompt, negativePrompt, signal);
}
