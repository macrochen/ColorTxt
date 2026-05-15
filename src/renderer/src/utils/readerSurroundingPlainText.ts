import type { ReaderLinesSource } from "./currentChapterPlainText";

export const READER_SURROUNDING_DEFAULT_MAX_CHARS = 500;

export type ReaderSurroundingSource = ReaderLinesSource & {
  getViewportTopLine?: () => number;
  getViewportEndLine?: () => number;
};

/**
 * 当前视窗内正文（优先），过长则按阅读探针位置截取一段。
 * 用于 AI system 中的「周边摘录」，不替代全书检索。
 */
export function getReaderSurroundingPlainText(
  reader: ReaderSurroundingSource | null | undefined,
  maxChars = READER_SURROUNDING_DEFAULT_MAX_CHARS,
): string {
  if (!reader) return "";
  const lc = reader.getModelLineCount();
  if (lc < 1) return "";

  const cap = Math.min(Math.max(80, maxChars), 4000);
  const topFn = reader.getViewportTopLine;
  const endFn = reader.getViewportEndLine;

  let top = 1;
  let end = lc;
  if (typeof topFn === "function" && typeof endFn === "function") {
    top = Math.max(1, Math.floor(topFn()));
    end = Math.min(lc, Math.max(top, Math.floor(endFn())));
  }

  const lines: string[] = [];
  for (let ln = top; ln <= end; ln++) {
    lines.push(reader.getEditorLineContent(ln));
  }
  let text = lines.join("\n").replace(/\r\n/g, "\n");
  if (text.length <= cap) return text;

  const probeRaw = reader.getProbeLine?.() ?? top;
  const probe = Math.max(top, Math.min(Math.floor(probeRaw), end));
  const probeLineIdx = probe - top;
  const offsets: number[] = [];
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    offsets.push(acc);
    acc += lines[i]!.length + (i < lines.length - 1 ? 1 : 0);
  }
  const lineStart = offsets[probeLineIdx] ?? 0;
  const centerChar =
    lineStart + Math.floor((lines[probeLineIdx] ?? "").length / 2);
  let sliceStart = Math.max(0, centerChar - Math.floor(cap / 2));
  let sliceEnd = Math.min(text.length, sliceStart + cap);
  if (sliceEnd - sliceStart < cap) {
    sliceStart = Math.max(0, sliceEnd - cap);
  }
  return text.slice(sliceStart, sliceEnd);
}
