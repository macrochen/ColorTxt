import type { Chapter } from "../chapter";
import type { AIChunkRecord } from "@shared/aiTypes";

export function estimateTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 1.5));
}

/** 按章节范围切片正文（行号 1-based，与 Chapter.lineNumber 一致） */
function sliceChapterText(
  fullText: string,
  lines: string[],
  lineStarts: number[],
  chapterIdx: number,
  chapters: Chapter[],
): { title: string; text: string; charStart: number; charEnd: number } {
  const ch = chapters[chapterIdx]!;
  const title = ch.title || `第 ${chapterIdx + 1} 章`;
  const startLine = Math.max(1, ch.lineNumber);
  const endLineExclusive =
    chapterIdx + 1 < chapters.length
      ? chapters[chapterIdx + 1]!.lineNumber
      : lines.length + 1;

  const startIdx = Math.min(lines.length, Math.max(0, startLine - 1));
  const endIdx = Math.min(lines.length, Math.max(startIdx, endLineExclusive - 1));

  const charStart = lineStarts[startIdx] ?? 0;
  const charEnd =
    endIdx < lines.length
      ? (lineStarts[endIdx] ?? fullText.length)
      : fullText.length;

  return {
    title,
    text: fullText.slice(charStart, charEnd),
    charStart,
    charEnd,
  };
}

function splitPieces(text: string, baseOffset: number): { t: string; rel: number }[] {
  const out: { t: string; rel: number }[] = [];
  if (!text) return out;
  const re = /[^\r\n]+(?:[\r\n]|(?=[^\r\n]|$))/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m[0];
    if (s.trim()) out.push({ t: s, rel: baseOffset + m.index });
  }
  if (out.length === 0 && text.trim()) {
    out.push({ t: text.trim(), rel: baseOffset });
  }
  return out;
}

export type ChunkDraft = Omit<AIChunkRecord, "embedding">;

export function chunkNovelForAi(opts: {
  fullText: string;
  chapters: Chapter[];
  bookHash: string;
  targetTokens: number;
  minTokens: number;
  overlapRatio: number;
}): ChunkDraft[] {
  const fullText = opts.fullText.replace(/\r\n/g, "\n");
  const lines = fullText.split("\n");
  const lineStarts: number[] = [];
  let acc = 0;
  for (const ln of lines) {
    lineStarts.push(acc);
    acc += ln.length + 1;
  }

  const chunks: ChunkDraft[] = [];
  let seq = 0;

  if (opts.chapters.length === 0) {
    const pieces = splitPieces(fullText, 0);
    let bufPieces: { t: string; rel: number }[] = [];
    let bufTokens = 0;
    const flush = () => {
      if (bufPieces.length === 0) return;
      const first = bufPieces[0]!;
      const last = bufPieces[bufPieces.length - 1]!;
      const content = bufPieces.map((x) => x.t).join("");
      const id = `${opts.bookHash}_g_${seq++}`;
      chunks.push({
        id,
        bookHash: opts.bookHash,
        chapterIndex: 0,
        chapterTitle: "正文",
        content: content.trim(),
        charStart: first.rel,
        charEnd: last.rel + last.t.length,
        tokenCount: bufTokens,
      });
      const overlapTok = Math.floor(bufTokens * opts.overlapRatio);
      if (overlapTok <= 0) {
        bufPieces = [];
        bufTokens = 0;
        return;
      }
      let back = 0;
      const keep: typeof bufPieces = [];
      for (let i = bufPieces.length - 1; i >= 0 && back < overlapTok; i--) {
        const p = bufPieces[i]!;
        keep.unshift(p);
        back += estimateTokens(p.t);
      }
      bufPieces = keep;
      bufTokens = bufPieces.reduce((s, p) => s + estimateTokens(p.t), 0);
    };
    for (const p of pieces) {
      const pt = estimateTokens(p.t);
      if (
        bufTokens + pt > opts.targetTokens &&
        bufTokens >= opts.minTokens &&
        bufPieces.length > 0
      ) {
        flush();
      }
      bufPieces.push(p);
      bufTokens += pt;
    }
    flush();
    return chunks;
  }

  for (let ci = 0; ci < opts.chapters.length; ci++) {
    const { title, text, charStart } = sliceChapterText(
      fullText,
      lines,
      lineStarts,
      ci,
      opts.chapters,
    );
    const pieces = splitPieces(text, 0);
    let bufPieces: { t: string; rel: number }[] = [];
    let bufTokens = 0;

    const flush = () => {
      if (bufPieces.length === 0) return;
      const first = bufPieces[0]!;
      const last = bufPieces[bufPieces.length - 1]!;
      const content = bufPieces.map((x) => x.t).join("");
      const startRel = first.rel;
      const endRel = last.rel + last.t.length;
      const id = `${opts.bookHash}_${ci}_${seq++}`;
      chunks.push({
        id,
        bookHash: opts.bookHash,
        chapterIndex: ci,
        chapterTitle: title,
        content: content.trim(),
        charStart: charStart + startRel,
        charEnd: charStart + endRel,
        tokenCount: bufTokens,
      });

      const overlapTok = Math.floor(bufTokens * opts.overlapRatio);
      if (overlapTok <= 0) {
        bufPieces = [];
        bufTokens = 0;
        return;
      }
      let back = 0;
      const keep: typeof bufPieces = [];
      for (let i = bufPieces.length - 1; i >= 0 && back < overlapTok; i--) {
        const p = bufPieces[i]!;
        keep.unshift(p);
        back += estimateTokens(p.t);
      }
      bufPieces = keep;
      bufTokens = bufPieces.reduce((s, p) => s + estimateTokens(p.t), 0);
    };

    for (const p of pieces) {
      const pt = estimateTokens(p.t);
      if (
        bufTokens + pt > opts.targetTokens &&
        bufTokens >= opts.minTokens &&
        bufPieces.length > 0
      ) {
        flush();
      }
      bufPieces.push(p);
      bufTokens += pt;
    }
    flush();
  }

  return chunks;
}
