import { app, contextBridge, ipcRenderer, webUtils } from "electron";
import type { FileFilter } from "electron";
import { EBOOK_CONVERT_DEFAULT_SUBDIR } from "@shared/ebookConvertPaths";
import type {
  AIChunkRecord,
  AIChatStreamPayload,
  AIConfig,
  AIIndexSearchHit,
} from "@shared/aiTypes";

/** sandbox 下 preload 不可 require('path')，与 renderer 的 joinFs 行为对齐 */
function joinUserDataSubdir(userData: string, segment: string): string {
  const base = userData.replace(/[/\\]+$/, "");
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}${segment.replace(/^[/\\]+|[/\\]+$/g, "")}`;
}

/** 磁盘上被读取的文件路径（通常为 .txt） */
export type StreamStart = {
  requestId: number;
  filePath: string;
  /** 与阅读会话绑定的逻辑路径（如电子书原路径）；缺省则与 filePath 相同 */
  sessionFilePath?: string;
  encoding?: string;
  totalBytes: number;
};
export type StreamChunkPayload = {
  requestId: number;
  filePath: string;
  sessionFilePath?: string;
  text: string;
  readBytes: number;
  totalBytes: number;
};
export type StreamEnd = {
  requestId: number;
  filePath: string;
  sessionFilePath?: string;
};
export type StreamError = {
  requestId: number;
  filePath: string;
  sessionFilePath?: string;
  message: string;
};

export type DirListTxtScanPayload =
  | { phase: "start"; dirPath: string }
  | { phase: "progress"; name: string };

// Signal for quick runtime verification from renderer.
try {
  (globalThis as any).__COLORTXT_PRELOAD__ = true;
} catch {
  // ignore
}

const openTxtFromShellQueue: string[] = [];
const openTxtFromShellCbs = new Set<(filePath: string) => void>();

function flushOpenTxtFromShellQueue() {
  if (openTxtFromShellCbs.size === 0 || openTxtFromShellQueue.length === 0) return;
  const batch = openTxtFromShellQueue.splice(0, openTxtFromShellQueue.length);
  for (const filePath of batch) {
    for (const cb of openTxtFromShellCbs) cb(filePath);
  }
}

ipcRenderer.on("app:open-txt-path", (_e, filePath: string) => {
  openTxtFromShellQueue.push(filePath);
  flushOpenTxtFromShellQueue();
});

const api = {
  openTxtDialog: () =>
    ipcRenderer.invoke("dialog:openTxt") as Promise<string | null>,
  openFilePlainDialog: () =>
    ipcRenderer.invoke("dialog:openFilePlain") as Promise<string | null>,
  openDirectoryPlainDialog: () =>
    ipcRenderer.invoke("dialog:openDirectoryPlain") as Promise<string | null>,
  openTxtDirectoryDialog: () =>
    ipcRenderer.invoke("dialog:openTxtDirectory") as Promise<{
      dirPaths: string[];
      files: Array<{ name: string; path: string; size: number }>;
    } | null>,
  confirmClearRecentFiles: () =>
    ipcRenderer.invoke("dialog:confirmClearRecentFiles") as Promise<boolean>,
  confirmClearFileList: () =>
    ipcRenderer.invoke("dialog:confirmClearFileList") as Promise<boolean>,
  confirmClearFileListCategory: (payload: {
    categoryLabel: string;
    count: number;
  }) =>
    ipcRenderer.invoke(
      "dialog:confirmClearFileListCategory",
      payload,
    ) as Promise<boolean>,
  confirmClearBookmarks: () =>
    ipcRenderer.invoke("dialog:confirmClearBookmarks") as Promise<boolean>,
  confirmClearHighlightTerms: () =>
    ipcRenderer.invoke(
      "dialog:confirmClearHighlightTerms",
    ) as Promise<boolean>,
  confirmClearAppCache: () =>
    ipcRenderer.invoke("dialog:confirmClearAppCache") as Promise<boolean>,
  confirmResetUiSettings: () =>
    ipcRenderer.invoke("dialog:confirmResetUiSettings") as Promise<boolean>,
  listTxtFilesInDirectory: (dirPath: string) =>
    ipcRenderer.invoke("dir:listTxtFiles", dirPath) as Promise<{
      dirPath: string;
      files: Array<{ name: string; path: string; size: number }>;
    }>,
  onDirListTxtScan: (cb: (payload: DirListTxtScanPayload) => void) => {
    const fn = (_: unknown, payload: DirListTxtScanPayload) => cb(payload);
    ipcRenderer.on("dir:listTxtFiles:scan", fn);
    return () => ipcRenderer.off("dir:listTxtFiles:scan", fn);
  },
  stat: (filePath: string) =>
    ipcRenderer.invoke("file:stat", filePath) as Promise<{
      size: number;
      mtimeMs: number;
      isFile: boolean;
      isDirectory: boolean;
    }>,
  getPath: (name: string) =>
    ipcRenderer.invoke("app:getPath", name) as Promise<string | null>,
  getUserDataPath: () => {
    try {
      return app.getPath("userData");
    } catch {
      return "";
    }
  },
  /** 默认电子书转 txt 输出目录：`userData/ConvertedTxt` */
  getDefaultEbookConvertOutputDir: () => {
    try {
      return joinUserDataSubdir(app.getPath("userData"), EBOOK_CONVERT_DEFAULT_SUBDIR);
    } catch {
      return "";
    }
  },
  pathToFileUrl: (filePath: string) =>
    ipcRenderer.invoke("path:toFileUrl", filePath) as Promise<string | null>,
  /**
   * 用于 `<img src>` / 灯箱：短 URL `colortxt-local://resource/{uuid}`，避免整段路径过长导致不发起请求。
   */
  pathToReadableLocalUrl: (filePath: string) =>
    ipcRenderer.invoke(
      "colortxtLocal:registerPath",
      filePath,
    ) as Promise<string | null>,
  readFileAsArrayBuffer: async (filePath: string) => {
    const data = (await ipcRenderer.invoke(
      "file:readFileAsBuffer",
      filePath,
    )) as ArrayBuffer | Uint8Array;
    if (data instanceof ArrayBuffer) return data;
    return data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
  },
  writeUtf8File: (filePath: string, utf8: string) =>
    ipcRenderer.invoke("file:writeUtf8File", filePath, utf8) as Promise<{
      ok: true;
    }>,
  writeBinaryFile: (filePath: string, base64: string) =>
    ipcRenderer.invoke("file:writeBinaryFile", filePath, base64) as Promise<{
      ok: true;
    }>,
  emptyDir: (dirPath: string) =>
    ipcRenderer.invoke("fs:emptyDir", dirPath) as Promise<{ ok: true }>,
  removePath: (targetPath: string) =>
    ipcRenderer.invoke("fs:removePath", targetPath) as Promise<{ ok: true }>,
  mkdir: (dirPath: string) =>
    ipcRenderer.invoke("fs:mkdir", dirPath) as Promise<{ ok: true }>,
  renamePath: (fromPath: string, toPath: string) =>
    ipcRenderer.invoke("fs:renamePath", fromPath, toPath) as Promise<
      | { ok: true; path: string; size: number }
      | { ok: false; message: string; code?: string }
    >,
  streamFile: (
    filePath: string,
    options?: { sessionFilePath?: string },
  ) =>
    ipcRenderer.send("file:stream", {
      physicalPath: filePath,
      sessionFilePath: options?.sessionFilePath,
    }),
  /** 由主进程 `fs.watch` 监控磁盘文件；传 `null` 停止 */
  watchCurrentFile: (filePath: string | null) =>
    ipcRenderer.invoke("file:watchCurrent", filePath) as Promise<void>,
  onCurrentFileDiskChanged: (
    cb: (payload: { path: string; mtimeMs: number }) => void,
  ) => {
    const fn = (_: unknown, payload: { path: string; mtimeMs: number }) =>
      cb(payload);
    ipcRenderer.on("file:disk-changed", fn);
    return () => ipcRenderer.off("file:disk-changed", fn);
  },
  setWindowTitle: (title: string) => ipcRenderer.send("window:setTitle", title),
  setFullscreen: (value: boolean) =>
    ipcRenderer.invoke("window:setFullscreen", value) as Promise<boolean>,
  shouldRestoreSession: () =>
    ipcRenderer.invoke("window:shouldRestoreSession") as Promise<boolean>,
  /** 安装包关联 / 命令行启动时由主进程写入，仅可取一次 */
  consumePendingOpenTxtPath: () =>
    ipcRenderer.invoke(
      "window:consumePendingOpenTxtPath",
    ) as Promise<string | null>,
  onOpenTxtFromShell: (cb: (filePath: string) => void) => {
    openTxtFromShellCbs.add(cb);
    flushOpenTxtFromShellQueue();
    return () => {
      openTxtFromShellCbs.delete(cb);
    };
  },
  setNativeTheme: (theme: string) => ipcRenderer.send("theme:set", theme),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  listSystemFonts: () =>
    ipcRenderer.invoke("fonts:listSystemFonts") as Promise<string[]>,
  openExternal: (url: string) =>
    ipcRenderer.invoke("shell:openExternal", url) as Promise<void>,
  showItemInFolder: (filePath: string) =>
    ipcRenderer.invoke("shell:showItemInFolder", filePath) as Promise<void>,
  openNewWindow: () => {
    ipcRenderer.send("window:new");
  },
  openFileInNewWindow: (filePath: string) => {
    ipcRenderer.send("window:new", filePath);
  },
  toggleDevTools: () =>
    ipcRenderer.invoke("window:toggleDevTools") as Promise<void>,
  getGlobalShortcut: () =>
    ipcRenderer.invoke("shortcut:getGlobalToggle") as Promise<string>,
  validateGlobalShortcut: (accelerator: string) =>
    ipcRenderer.invoke("shortcut:validateGlobalToggle", accelerator) as Promise<{
      ok: boolean;
      message?: string;
    }>,
  setGlobalShortcut: (accelerator: string) =>
    ipcRenderer.invoke("shortcut:setGlobalToggle", accelerator) as Promise<{
      ok: boolean;
      message?: string;
    }>,
  suspendGlobalShortcutsForRecording: () =>
    ipcRenderer.invoke("shortcut:suspendForRecording") as Promise<void>,
  resumeGlobalShortcutsAfterRecording: () =>
    ipcRenderer.invoke("shortcut:resumeAfterRecording") as Promise<void>,
  quitApp: () => {
    ipcRenderer.send("app:quit");
  },
  onStreamStart: (cb: (payload: StreamStart) => void) => {
    const fn = (_: unknown, payload: StreamStart) => cb(payload);
    ipcRenderer.on("file:stream-start", fn);
    return () => ipcRenderer.off("file:stream-start", fn);
  },
  onStreamChunk: (cb: (payload: StreamChunkPayload) => void) => {
    const fn = (_: unknown, payload: StreamChunkPayload) => cb(payload);
    ipcRenderer.on("file:stream-chunk", fn);
    return () => ipcRenderer.off("file:stream-chunk", fn);
  },
  onStreamEnd: (cb: (payload: StreamEnd) => void) => {
    const fn = (_: unknown, payload: StreamEnd) => cb(payload);
    ipcRenderer.on("file:stream-end", fn);
    return () => ipcRenderer.off("file:stream-end", fn);
  },
  onStreamError: (cb: (payload: StreamError) => void) => {
    const fn = (_: unknown, payload: StreamError) => cb(payload);
    ipcRenderer.on("file:stream-error", fn);
    return () => ipcRenderer.off("file:stream-error", fn);
  },
  onFullscreenChanged: (cb: (payload: { isFullscreen: boolean }) => void) => {
    const fn = (_: unknown, payload: { isFullscreen: boolean }) => cb(payload);
    ipcRenderer.on("window:fullscreen-changed", fn);
    return () => ipcRenderer.off("window:fullscreen-changed", fn);
  },
  onThemeSync: (cb: (theme: string) => void) => {
    const fn = (_: unknown, theme: string) => cb(theme);
    ipcRenderer.on("theme:sync", fn);
    return () => ipcRenderer.off("theme:sync", fn);
  },
  isPackaged: () =>
    ipcRenderer.invoke("app:isPackaged") as Promise<boolean>,
  isWindowsPortable: () =>
    ipcRenderer.invoke("app:isWindowsPortable") as Promise<boolean>,
  checkForUpdates: () =>
    ipcRenderer.invoke("updater:check") as Promise<
      | { skipped: true }
      | { ok: true }
      | { ok: false; message: string }
    >,
  downloadUpdate: () =>
    ipcRenderer.invoke("updater:download") as Promise<
      | { skipped: true }
      | { ok: true }
      | { ok: false; message: string }
    >,
  quitAndInstall: () =>
    ipcRenderer.invoke("updater:quitAndInstall") as Promise<boolean>,
  onUpdaterUpdateAvailable: (cb: (payload: { version: string }) => void) => {
    const fn = (_: unknown, payload: { version: string }) => cb(payload);
    ipcRenderer.on("updater:update-available", fn);
    return () => ipcRenderer.off("updater:update-available", fn);
  },
  onUpdaterUpdateNotAvailable: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("updater:update-not-available", fn);
    return () => ipcRenderer.off("updater:update-not-available", fn);
  },
  onUpdaterError: (cb: (payload: { message: string }) => void) => {
    const fn = (_: unknown, payload: { message: string }) => cb(payload);
    ipcRenderer.on("updater:error", fn);
    return () => ipcRenderer.off("updater:error", fn);
  },
  onUpdaterDownloadProgress: (
    cb: (payload: {
      percent: number;
      transferred: number;
      total: number;
    }) => void,
  ) => {
    const fn = (
      _: unknown,
      payload: { percent: number; transferred: number; total: number },
    ) => cb(payload);
    ipcRenderer.on("updater:download-progress", fn);
    return () => ipcRenderer.off("updater:download-progress", fn);
  },
  onUpdaterUpdateDownloaded: (cb: (payload: { version: string }) => void) => {
    const fn = (_: unknown, payload: { version: string }) => cb(payload);
    ipcRenderer.on("updater:update-downloaded", fn);
    return () => ipcRenderer.off("updater:update-downloaded", fn);
  },

  openCtixDialog: () =>
    ipcRenderer.invoke("dialog:openCtix") as Promise<string | null>,
  extensionList: () =>
    ipcRenderer.invoke("extension:list") as Promise<
      Array<{
        name: string;
        displayName: string;
        description: string;
        version: string;
        builtin: boolean;
        dev: boolean;
        enabled: boolean;
        rootFsPath: string;
        manifest: Record<string, unknown>;
        views: Array<{
          viewId: string;
          viewTitle: string;
          entry: string;
          containerId: string;
          containerTitle: string;
          containerIcon: string;
        }>;
      }>
    >,
  extensionInstallFromCtix: (filePath: string) =>
    ipcRenderer.invoke(
      "extension:installFromCtix",
      filePath,
    ) as Promise<{ ok: true } | { ok: false; error: string }>,
  extensionUninstall: (name: string) =>
    ipcRenderer.invoke(
      "extension:uninstall",
      name,
    ) as Promise<{ ok: true } | { ok: false; error: string }>,
  extensionSetEnabled: (payload: {
    name: string;
    enabled: boolean;
    builtin: boolean;
  }) =>
    ipcRenderer.invoke(
      "extension:setEnabled",
      payload,
    ) as Promise<{ ok: true } | { ok: false; error: string }>,
  extensionGetDevPaths: () =>
    ipcRenderer.invoke("extension:getDevPaths") as Promise<string[]>,
  extensionRefreshRoots: () =>
    ipcRenderer.invoke("extension:refreshRoots") as Promise<{ ok: true }>,

  ai: {
    configGet: () => ipcRenderer.invoke("ai:config:get") as Promise<AIConfig>,
    configSet: (cfg: AIConfig) =>
      ipcRenderer.invoke(
        "ai:config:set",
        JSON.parse(JSON.stringify(cfg)) as AIConfig,
      ) as Promise<{ ok: true } | { ok: false; error: string }>,
    embed: (texts: string[]) =>
      ipcRenderer.invoke("ai:embedding:embed", texts) as Promise<number[][]>,
    indexHasBook: (bookHash: string) =>
      ipcRenderer.invoke("ai:index:hasBook", bookHash) as Promise<boolean>,
    indexDeleteBook: (bookHash: string) =>
      ipcRenderer.invoke("ai:index:deleteBook", bookHash) as Promise<{
        ok: boolean;
      }>,
    indexReplaceChunks: (bookHash: string, chunks: AIChunkRecord[]) =>
      ipcRenderer.invoke(
        "ai:index:replaceChunks",
        bookHash,
        chunks,
      ) as Promise<{ ok: boolean; error?: string }>,
    indexSearch: (args: {
      bookHash: string;
      queryEmbedding: number[];
      topK?: number;
    }) =>
      ipcRenderer.invoke("ai:index:search", args) as Promise<
        AIIndexSearchHit[] | { error: string }
      >,
    chatStart: (payload: AIChatStreamPayload) =>
      ipcRenderer.invoke(
        "ai:chat:start",
        JSON.parse(JSON.stringify(payload)) as AIChatStreamPayload,
      ) as Promise<{ ok: true } | { ok: false; error?: string }>,
    chatAbort: (requestId: number) =>
      ipcRenderer.invoke("ai:chat:abort", requestId) as Promise<{ ok: true }>,
    modelsList: (draft: { baseUrl: string; apiKey: string }) =>
      ipcRenderer.invoke("ai:models:list", draft) as Promise<
        { ok: true; models: string[] } | { ok: false; error: string }
      >,
    testChat: (draft: Record<string, unknown>) =>
      ipcRenderer.invoke("ai:test:chat", draft) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    testEmbedding: (draft: Record<string, unknown>) =>
      ipcRenderer.invoke("ai:test:embedding", draft) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    embeddingProbeDimension: (draft: {
      baseUrl: string;
      apiKey: string;
      model: string;
    }) =>
      ipcRenderer.invoke(
        "ai:embedding:probeDimension",
        draft,
      ) as Promise<
        { ok: true; dimension: number } | { ok: false; error: string }
      >,
    threadList: (bookHash: string) =>
      ipcRenderer.invoke("ai:thread:list", bookHash) as Promise<
        Array<{
          id: string;
          bookHash: string;
          title: string;
          createdAt: number;
          updatedAt: number;
        }>
      >,
    threadCreate: (bookHash: string, title?: string) =>
      ipcRenderer.invoke("ai:thread:create", bookHash, title) as Promise<string>,
    threadRename: (threadId: string, title: string) =>
      ipcRenderer.invoke("ai:thread:rename", threadId, title) as Promise<void>,
    threadDelete: (threadId: string) =>
      ipcRenderer.invoke("ai:thread:delete", threadId) as Promise<void>,
    messageList: (threadId: string) =>
      ipcRenderer.invoke("ai:message:list", threadId) as Promise<
        Array<{
          id: string;
          threadId: string;
          role: string;
          content: string;
          createdAt: number;
          aborted: boolean;
        }>
      >,
    messageAppend: (
      threadId: string,
      role: "user" | "assistant" | "system",
      content: string,
      aborted?: boolean,
    ) =>
      ipcRenderer.invoke(
        "ai:message:append",
        threadId,
        role,
        content,
        aborted,
      ) as Promise<string>,
    exportSave: (payload: {
      defaultName: string;
      data: string;
      filters?: FileFilter[];
      /** 完整默认路径（目录+文件名），绝对路径时用作对话框初始位置 */
      defaultPath?: string;
    }) =>
      ipcRenderer.invoke("ai:export:save", payload) as Promise<
        | { ok: true; path: string }
        | { ok: false; cancelled: true }
        | { ok: false; error: string }
      >,
    onChatChunk: (
      cb: (payload: { requestId: number; delta: string }) => void,
    ) => {
      const fn = (_: unknown, payload: { requestId: number; delta: string }) =>
        cb(payload);
      ipcRenderer.on("ai:chat:chunk", fn);
      return () => ipcRenderer.off("ai:chat:chunk", fn);
    },
    onChatDone: (cb: (payload: { requestId: number }) => void) => {
      const fn = (_: unknown, payload: { requestId: number }) => cb(payload);
      ipcRenderer.on("ai:chat:done", fn);
      return () => ipcRenderer.off("ai:chat:done", fn);
    },
    onChatError: (
      cb: (payload: { requestId: number; message: string }) => void,
    ) => {
      const fn = (_: unknown, payload: { requestId: number; message: string }) =>
        cb(payload);
      ipcRenderer.on("ai:chat:error", fn);
      return () => ipcRenderer.off("ai:chat:error", fn);
    },
  },
};

contextBridge.exposeInMainWorld("colorTxt", api);

export type ColorTxtApi = typeof api;
