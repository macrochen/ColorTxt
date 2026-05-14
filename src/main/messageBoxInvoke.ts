import type { MessageBoxOptions } from "electron";

const ALLOWED_TYPES = new Set([
  "none",
  "info",
  "error",
  "question",
  "warning",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 将渲染进程经 IPC 传入的 payload 转为安全的 `MessageBoxOptions`。
 * 仅白名单字段，避免异常结构与不可序列化字段进入 Electron。
 */
export function parseShowMessageBoxOptions(
  raw: unknown,
): MessageBoxOptions {
  if (!isPlainObject(raw)) {
    throw new TypeError("showMessageBox: options must be a plain object");
  }
  if (typeof raw.message !== "string") {
    throw new TypeError("showMessageBox: message must be a string");
  }
  const out: MessageBoxOptions = { message: raw.message };

  if (typeof raw.type === "string" && ALLOWED_TYPES.has(raw.type)) {
    out.type = raw.type as MessageBoxOptions["type"];
  }
  if (
    Array.isArray(raw.buttons) &&
    raw.buttons.length > 0 &&
    raw.buttons.every((b) => typeof b === "string")
  ) {
    out.buttons = raw.buttons as string[];
  }
  if (typeof raw.defaultId === "number" && Number.isFinite(raw.defaultId)) {
    out.defaultId = Math.trunc(raw.defaultId);
  }
  if (typeof raw.cancelId === "number" && Number.isFinite(raw.cancelId)) {
    out.cancelId = Math.trunc(raw.cancelId);
  }
  if (typeof raw.title === "string") out.title = raw.title;
  if (typeof raw.detail === "string") out.detail = raw.detail;
  if (typeof raw.checkboxLabel === "string")
    out.checkboxLabel = raw.checkboxLabel;
  if (typeof raw.checkboxChecked === "boolean")
    out.checkboxChecked = raw.checkboxChecked;
  if (typeof raw.icon === "string" && raw.icon.length > 0) out.icon = raw.icon;
  if (typeof raw.noLink === "boolean") out.noLink = raw.noLink;
  if (typeof raw.normalizeAccessKeys === "boolean")
    out.normalizeAccessKeys = raw.normalizeAccessKeys;
  if (typeof raw.textWidth === "number" && Number.isFinite(raw.textWidth)) {
    out.textWidth = Math.trunc(raw.textWidth);
  }

  return out;
}
