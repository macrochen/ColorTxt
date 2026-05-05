import type { Chapter } from "../chapter";
import { pickActiveChapterIdx } from "../reader/chapterIndex";

/** 与扩展 RPC `getCurrentChapterText` 对齐的上限；注入 AI system 时再收紧 */
const HARD_CAP = 512_000;

export type ReaderLinesSource = {
  getModelLineCount: () => number;
  getEditorLineContent: (lineNumber: number) => string;
  getProbeLine?: () => number;
  /** 与 Monaco 全文一致；用于编辑器 API 取行异常时的后备切片 */
  getAllText?: () => string;
};

/**
 * 当前阅读位置所在章节全文（从章节标题行到下一章标题行前一行）。
 * `activeChapterIdx < 0` 时用 `getProbeLine()` 推断章节。
 */
export function getCurrentChapterPlainText(
  reader: ReaderLinesSource | null | undefined,
  chapters: readonly Chapter[],
  activeChapterIdx: number,
  maxChars = 80_000,
): string {
  if (!reader || chapters.length === 0) return "";
  let idx = activeChapterIdx;
  if (idx < 0) {
    const probe = Math.max(1, Math.floor(reader.getProbeLine?.() ?? 1));
    idx = pickActiveChapterIdx(chapters, probe);
  }
  if (idx < 0) return "";
  const startLine = chapters[idx]!.lineNumber;
  const lc = reader.getModelLineCount();
  const endExclusive =
    idx + 1 < chapters.length ? chapters[idx + 1]!.lineNumber : lc + 1;
  const cap = Math.min(Math.max(2048, maxChars), HARD_CAP);
  const parts: string[] = [];
  let total = 0;
  for (let ln = startLine; ln < endExclusive && ln <= lc; ln++) {
    const line = reader.getEditorLineContent(ln);
    const piece = ln < endExclusive - 1 ? `${line}\n` : line;
    if (total + piece.length > cap) {
      parts.push(piece.slice(0, Math.max(0, cap - total)));
      break;
    }
    parts.push(piece);
    total += piece.length;
    if (total >= cap) break;
  }
  const fromEditor = parts.join("");
  if (fromEditor.trim() !== "") return fromEditor;

  const full = reader.getAllText?.();
  if (!full) return "";
  return sliceChapterFromFullText(full, chapters, idx, cap);
}

/**
 * 按章节表中的 1-based 行号，从全文 `\n` 分行结果切片（与 rebuildChapters / 流式写入所用行号一致）。
 */
function sliceChapterFromFullText(
  fullText: string,
  chapters: readonly Chapter[],
  idx: number,
  maxChars: number,
): string {
  const lines = fullText.split(/\n/);
  const lc = lines.length;
  const startLine = chapters[idx]!.lineNumber;
  const endExclusive =
    idx + 1 < chapters.length ? chapters[idx + 1]!.lineNumber : lc + 1;
  if (startLine < 1 || startLine > lc || startLine >= endExclusive) return "";
  const body = lines.slice(startLine - 1, endExclusive - 1).join("\n");
  if (!body.trim()) return "";
  return body.length <= maxChars ? body : body.slice(0, maxChars);
}
