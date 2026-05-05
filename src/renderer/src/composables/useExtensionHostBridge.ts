import {
  onMounted,
  onUnmounted,
  shallowRef,
  watch,
  type InjectionKey,
  type Ref,
} from "vue";
import type ReaderMain from "../components/ReaderMain.vue";
import type { Chapter } from "../chapter";
import { pickActiveChapterIdx } from "../reader/chapterIndex";
import { getCurrentChapterPlainText } from "../utils/currentChapterPlainText";

export const EXT_MSG_REQUEST = "colortxt/ext:request";
export const EXT_MSG_RESPONSE = "colortxt/ext:response";
export const EXT_MSG_EVENT = "colortxt/ext:event";
export const EXT_MSG_INIT = "colortxt/ext:init";
const EXT_MSG_HOST_THEME_CLASS = "colortxt/ext:host-theme-class";

const MAX_TEXT_CHARS = 2_000_000;
const MAX_CHAPTER_CHARS = 512_000;

type Registration = {
  iframe: HTMLIFrameElement;
  extId: string;
  viewId: string;
};

export type ExtensionHostBridge = {
  registerExtensionIframe: (
    iframe: HTMLIFrameElement,
    meta: { extId: string; viewId: string },
  ) => () => void;
  notifyFileStreamEnd: () => void;
  notifyFileClosed: () => void;
  notifyChaptersRebuilt: () => void;
  notifySelectionChanged: (payload: {
    text: string;
    startLine: number;
    endLine: number;
    isEmpty: boolean;
  }) => void;
};

export const extensionHostBridgeKey: InjectionKey<ExtensionHostBridge> =
  Symbol("extensionHostBridge");

export function useExtensionHostBridge(deps: {
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  chapters: Ref<Chapter[]>;
  activeChapterIdx: Ref<number>;
  lastProbeLine: Ref<number>;
  currentFile: Ref<string | null>;
  currentTheme: Ref<string>;
  jumpToChapter: (ch: Chapter) => void;
}): ExtensionHostBridge {
  const registrations = shallowRef<Registration[]>([]);

  function broadcastEvent(event: string, payload?: unknown) {
    for (const r of registrations.value) {
      r.iframe.contentWindow?.postMessage(
        { type: EXT_MSG_EVENT, event, payload },
        "*",
      );
    }
  }

  function sendInit(entry: Registration) {
    entry.iframe.contentWindow?.postMessage(
      {
        type: EXT_MSG_INIT,
        extId: entry.extId,
        viewId: entry.viewId,
      },
      "*",
    );
  }


  function broadcastHostThemeClass(themeId: string) {
    const dark = themeId.trim() !== "vs";
    for (const r of registrations.value) {
      r.iframe.contentWindow?.postMessage(
        { type: EXT_MSG_HOST_THEME_CLASS, dark },
        "*",
      );
    }
  }

  function registerExtensionIframe(
    iframe: HTMLIFrameElement,
    meta: { extId: string; viewId: string },
  ): () => void {
    const entry: Registration = { iframe, ...meta };
    registrations.value = [...registrations.value, entry];
    queueMicrotask(() => {
      sendInit(entry);
      broadcastHostThemeClass(deps.currentTheme.value);
    });
    return () => {
      registrations.value = registrations.value.filter((x) => x !== entry);
    };
  }

  watch(
    () => deps.currentTheme.value,
    (theme) => {
      broadcastHostThemeClass(theme);
    },
  );

  let lastTextFetch = 0;
  function throttleTextFetch(): boolean {
    const now = Date.now();
    if (now - lastTextFetch < 120) return false;
    lastTextFetch = now;
    return true;
  }

  function getCurrentChapterText(maxChars?: number): string {
    const reader = deps.readerRef.value;
    const list = deps.chapters.value;
    if (!reader || list.length === 0) return "";
    let idx = deps.activeChapterIdx.value;
    if (idx < 0) {
      idx = pickActiveChapterIdx(list, deps.lastProbeLine.value);
    }
    const cap = Math.min(maxChars ?? MAX_CHAPTER_CHARS, MAX_CHAPTER_CHARS);
    return getCurrentChapterPlainText(reader, list, idx, cap);
  }

  async function dispatch(
    method: string,
    params: unknown,
    reg: Registration,
  ): Promise<unknown> {
    const reader = deps.readerRef.value;
    switch (method) {
      case "getChapters":
        return deps.chapters.value.map((c) => ({ ...c }));
      case "getCurrentFilePath":
        return deps.currentFile.value;
      case "getSelectedText":
        return reader?.getSelectedText?.() ?? "";
      case "getText": {
        if (!reader || !throttleTextFetch()) {
          throw new Error("请求过频或无阅读器");
        }
        const p = (params ?? {}) as {
          maxChars?: number;
          startLine?: number;
          endLine?: number;
        };
        const maxChars = Math.min(
          typeof p.maxChars === "number" && Number.isFinite(p.maxChars)
            ? p.maxChars
            : MAX_TEXT_CHARS,
          MAX_TEXT_CHARS,
        );
        const start =
          typeof p.startLine === "number" && Number.isFinite(p.startLine)
            ? Math.max(1, Math.floor(p.startLine))
            : null;
        const end =
          typeof p.endLine === "number" && Number.isFinite(p.endLine)
            ? Math.max(1, Math.floor(p.endLine))
            : null;
        if (start != null && end != null && end >= start) {
          const lc = reader.getModelLineCount?.() ?? 0;
          const hi = Math.min(end, lc);
          const parts: string[] = [];
          let total = 0;
          for (let ln = start; ln <= hi; ln++) {
            const line = reader.getEditorLineContent(ln);
            const chunk = ln < hi ? `${line}\n` : line;
            if (total + chunk.length > maxChars) {
              parts.push(chunk.slice(0, Math.max(0, maxChars - total)));
              break;
            }
            parts.push(chunk);
            total += chunk.length;
          }
          return parts.join("");
        }
        const full = reader.getAllText?.() ?? "";
        return full.slice(0, maxChars);
      }
      case "getCurrentChapterText": {
        if (!throttleTextFetch()) throw new Error("请求过频");
        const p = (params ?? {}) as { maxChars?: number };
        const mc =
          typeof p.maxChars === "number" && Number.isFinite(p.maxChars)
            ? p.maxChars
            : undefined;
        return getCurrentChapterText(mc);
      }
      case "jumpToLine": {
        const line = (params as { line?: number })?.line;
        if (typeof line !== "number" || !Number.isFinite(line)) {
          throw new Error("无效行号");
        }
        reader?.jumpToLineCentered?.(Math.max(1, Math.floor(line)), true);
        return null;
      }
      case "jumpToChapterByLine": {
        const line = (params as { lineNumber?: number })?.lineNumber;
        if (typeof line !== "number" || !Number.isFinite(line)) {
          throw new Error("无效章节行号");
        }
        const list = deps.chapters.value;
        const hit = list.find((c) => c.lineNumber === line);
        if (hit) deps.jumpToChapter(hit);
        else reader?.jumpToLineCentered?.(Math.max(1, Math.floor(line)), true);
        return null;
      }
      case "ping":
        return { extId: reg.extId, viewId: reg.viewId };
      default:
        throw new Error(`未知方法: ${method}`);
    }
  }

  async function onWindowMessage(ev: MessageEvent) {
    const data = ev.data as {
      type?: string;
      id?: string;
      method?: string;
      params?: unknown;
    };
    if (!data || data.type !== EXT_MSG_REQUEST) return;
    const src = ev.source;
    const reg = registrations.value.find((r) => r.iframe.contentWindow === src);
    if (!reg || typeof data.id !== "string" || typeof data.method !== "string") {
      return;
    }
    try {
      const result = await dispatch(data.method, data.params, reg);
      reg.iframe.contentWindow?.postMessage(
        {
          type: EXT_MSG_RESPONSE,
          id: data.id,
          ok: true,
          result,
        },
        "*",
      );
    } catch (err) {
      reg.iframe.contentWindow?.postMessage(
        {
          type: EXT_MSG_RESPONSE,
          id: data.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
        "*",
      );
    }
  }

  onMounted(() => window.addEventListener("message", onWindowMessage));
  onUnmounted(() => window.removeEventListener("message", onWindowMessage));

  return {
    registerExtensionIframe,
    notifyFileStreamEnd: () => broadcastEvent("file:streamEnd"),
    notifyFileClosed: () => broadcastEvent("file:closed"),
    notifyChaptersRebuilt: () => broadcastEvent("chapters:rebuilt"),
    notifySelectionChanged: (payload) =>
      broadcastEvent("selection:changed", payload),
  };
}
