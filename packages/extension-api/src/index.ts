/**
 * ColorTxt 扩展 iframe 内使用的轻量客户端（通过父窗口 postMessage）。
 * 与宿主约定一致：`colortxt/ext:request` / `response` / `event` / `init`。
 */

export const EXT_MSG_REQUEST = "colortxt/ext:request";
export const EXT_MSG_RESPONSE = "colortxt/ext:response";
export const EXT_MSG_EVENT = "colortxt/ext:event";
export const EXT_MSG_INIT = "colortxt/ext:init";

export type ExtensionInitMessage = {
  type: typeof EXT_MSG_INIT;
  extId: string;
  viewId: string;
};

export type ExtensionEventMessage = {
  type: typeof EXT_MSG_EVENT;
  event: string;
  payload?: unknown;
};

export function createColortxtExtensionClient(options?: {
  /** 请求超时 ms */
  timeoutMs?: number;
}) {
  const timeoutMs = options?.timeoutMs ?? 15000;
  let seq = 0;
  const pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  function onMessage(ev: MessageEvent) {
    const d = ev.data as { type?: string; id?: string };
    if (!d || typeof d !== "object") return;
    if (d.type !== EXT_MSG_RESPONSE || typeof d.id !== "string") return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    const full = ev.data as {
      ok: boolean;
      result?: unknown;
      error?: string;
    };
    if (full.ok) p.resolve(full.result);
    else p.reject(new Error(full.error ?? "unknown error"));
  }

  window.addEventListener("message", onMessage);

  function dispose() {
    window.removeEventListener("message", onMessage);
    for (const [, p] of pending) {
      p.reject(new Error("disposed"));
    }
    pending.clear();
  }

  function request(method: string, params?: unknown): Promise<unknown> {
    const id = String(++seq);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ type: EXT_MSG_REQUEST, id, method, params }, "*");
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  function onEvent(
    cb: (event: string, payload?: unknown) => void,
  ): () => void {
    const fn = (ev: MessageEvent) => {
      const d = ev.data as ExtensionEventMessage | ExtensionInitMessage;
      if (!d || typeof d !== "object") return;
      if (d.type === EXT_MSG_EVENT) cb(d.event, d.payload);
    };
    window.addEventListener("message", fn);
    return () => window.removeEventListener("message", fn);
  }

  function onInit(cb: (msg: ExtensionInitMessage) => void): () => void {
    const fn = (ev: MessageEvent) => {
      const d = ev.data as ExtensionInitMessage;
      if (d?.type === EXT_MSG_INIT) cb(d);
    };
    window.addEventListener("message", fn);
    return () => window.removeEventListener("message", fn);
  }

  return {
    request,
    onEvent,
    onInit,
    dispose,
    getChapters: () => request("getChapters"),
    getCurrentFilePath: () => request("getCurrentFilePath"),
    getSelectedText: () => request("getSelectedText"),
    getText: (params?: {
      maxChars?: number;
      startLine?: number;
      endLine?: number;
    }) => request("getText", params),
    getCurrentChapterText: (params?: { maxChars?: number }) =>
      request("getCurrentChapterText", params),
    jumpToLine: (line: number) => request("jumpToLine", { line }),
    jumpToChapterByLine: (lineNumber: number) =>
      request("jumpToChapterByLine", { lineNumber }),
  };
}
