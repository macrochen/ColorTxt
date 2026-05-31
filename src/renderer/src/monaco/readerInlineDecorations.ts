import type * as monaco from "monaco-editor";
import type { ReaderSurfacePalette } from "../constants/readerPalette";
import {
  CHAPTER_TITLE_LINE_CLASS,
  type ChapterStickyLine,
} from "./chapterStickyScroll";

const EDITOR_BACKGROUND_TRANSPARENT = "#00000000";

/** 与 VS Code editorOverviewRuler.border 默认一致 */
const READER_OVERVIEW_RULER_BORDER = "#7f7f7f4d";

function hexForThemeRule(hexWithHash: string): string {
  return hexWithHash.replace(/^#/, "");
}

function parseHex6(hex: string): [number, number, number] {
  const s = hex.replace(/^#/, "");
  if (s.length !== 6) return [0, 0, 0];
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

/** Monaco 主题色 #RRGGBBAA，用于半透明滚动条滑块（可透出概览尺标记） */
function hex8(rgb: string, alpha: number): string {
  const [r, g, b] = parseHex6(rgb);
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${a.toString(16).padStart(2, "0")}`;
}

/** 主编辑器 / 小地图高亮：当前行（灰）与选区（蓝）分离 */
function readerEditorHighlightColors(
  variant: "light" | "dark",
): Pick<
  Record<string, string>,
  | "editor.lineHighlightBackground"
  | "editor.selectionBackground"
  | "minimap.selectionHighlight"
  | "minimap.selectionOccurrenceHighlight"
> {
  if (variant === "dark") {
    return {
      "editor.lineHighlightBackground": hex8("#ffffff", 0.07),
      "editor.selectionBackground": hex8("#264F78", 0.45),
      /** 小地图选区：Monaco 行高亮会再叠 50% 透明，字符级选区为实色 */
      "minimap.selectionHighlight": "#264F78",
      "minimap.selectionOccurrenceHighlight": hex8("#676767", 0.55),
    };
  }
  return {
    "editor.lineHighlightBackground": hex8("#000000", 0.05),
    "editor.selectionBackground": hex8("#ADD6FF", 0.55),
    "minimap.selectionHighlight": "#ADD6FF",
    "minimap.selectionOccurrenceHighlight": hex8("#c9c9c9", 0.55),
  };
}

/** 小地图当前行（仅光标、无选区）：灰底 inline 装饰，与选区蓝色区分 */
export function getReaderMinimapCursorLineDecorColor(
  themeName: string,
): string {
  return themeName === "vs" ? hex8("#000000", 0.12) : hex8("#ffffff", 0.14);
}

/** 滚动条滑块 / 小地图视口框：轨道透明；滑块半透明（同 VS Code） */
function readerChromeThemeColors(
  palette: ReaderSurfacePalette,
  variant: "light" | "dark",
): Record<string, string> {
  const surfaceBg = palette.readerBg;
  const base = {
    "editor.background": EDITOR_BACKGROUND_TRANSPARENT,
    "editor.foreground": palette.bodyText,
    "minimap.background": surfaceBg,
    /** 滚动条轨道与小地图同色；光标标记在概览尺 Canvas 上，叠在轨道之上（见 readerMainMonaco.css） */
    "scrollbar.background": surfaceBg,
    /** 概览尺 Canvas 透明底，仅绘制光标/装饰标记 */
    "editorOverviewRuler.background": EDITOR_BACKGROUND_TRANSPARENT,
    "editorOverviewRuler.border": READER_OVERVIEW_RULER_BORDER,
    ...readerEditorHighlightColors(variant),
  };
  if (variant === "dark") {
    return {
      ...base,
      /** Monaco 小地图左侧内阴影（同 VS Code scrollbar.shadow 默认） */
      "scrollbar.shadow": "#000000",
      "scrollbarSlider.background": hex8("#bfbfbf", 0.4),
      "scrollbarSlider.hoverBackground": hex8("#d4d4d4", 0.55),
      "scrollbarSlider.activeBackground": hex8("#ffffff", 0.65),
      "minimapSlider.background": "#ffffff40",
      "minimapSlider.hoverBackground": "#ffffff55",
      "minimapSlider.activeBackground": "#ffffff66",
    };
  }
  return {
    ...base,
    "scrollbar.shadow": "#DDDDDD",
    "scrollbarSlider.background": hex8("#646464", 0.4),
    "scrollbarSlider.hoverBackground": hex8("#4a4a4a", 0.55),
    "scrollbarSlider.activeBackground": hex8("#383838", 0.7),
    "minimapSlider.background": "#00000045",
    "minimapSlider.hoverBackground": "#00000058",
    "minimapSlider.activeBackground": "#0000006a",
  };
}

function readerThemeEditorColors(
  palette: ReaderSurfacePalette,
  variant: "light" | "dark",
) {
  return readerChromeThemeColors(palette, variant);
}

/** 与 txtrTextMonarch 一致：quoteInner / bracketInner 为兜底；引号内先自定义高亮再括号开符，故高亮词优先于 quoteInner */
function buildTxtrTokenRules(
  palette: ReaderSurfacePalette,
  highlightColors: readonly string[],
) {
  const hlRules = highlightColors.map((c, i) => ({
    token: `txtr.customHighlight.${i}`,
    foreground: hexForThemeRule(c),
  }));
  return [
    {
      token: "txtr.quoteInner",
      foreground: hexForThemeRule(palette.txtrQuoteInner),
    },
    {
      token: "txtr.bracketInner",
      foreground: hexForThemeRule(palette.txtrBracketInner),
    },
    {
      token: "txtr.punctuation",
      foreground: hexForThemeRule(palette.txtrPunctuation),
    },
    {
      token: "txtr.specialMarker",
      foreground: hexForThemeRule(palette.txtrSpecialMarker),
    },
    {
      token: "txtr.number",
      foreground: hexForThemeRule(palette.txtrNumber),
    },
    {
      token: "txtr.english",
      foreground: hexForThemeRule(palette.txtrEnglish),
    },
    ...hlRules,
  ];
}

/**
 * 注入 vs / vs-dark 的 Monarch token 颜色；编辑器背景透明以透出 var(--reader-bg)。
 * 应在注册 Monarch 之后、setTheme 之前调用一次；调色板变更时可再调用。
 */
export function ensureReaderSyntaxThemes(
  monacoApi: typeof import("monaco-editor"),
  lightPalette: ReaderSurfacePalette,
  darkPalette: ReaderSurfacePalette,
  highlightColors: readonly string[],
): void {
  monacoApi.editor.defineTheme("vs-dark", {
    base: "vs-dark",
    inherit: true,
    rules: buildTxtrTokenRules(darkPalette, highlightColors),
    colors: readerThemeEditorColors(darkPalette, "dark"),
  });
  monacoApi.editor.defineTheme("vs", {
    base: "vs",
    inherit: true,
    rules: buildTxtrTokenRules(lightPalette, highlightColors),
    colors: readerThemeEditorColors(lightPalette, "light"),
  });
}

/**
 * 开关 Monaco 中 txtr.* 的语法着色（标点/数字/英文/引号内/括号内等）。
 * 关闭时仅继承 vs / vs-dark 默认前景；背景仍透明以透出阅读区底色。
 */
export function setReaderSyntaxHighlightEnabled(
  monacoApi: typeof import("monaco-editor"),
  enabled: boolean,
  lightPalette: ReaderSurfacePalette,
  darkPalette: ReaderSurfacePalette,
  highlightColors: readonly string[],
): void {
  if (enabled) {
    ensureReaderSyntaxThemes(
      monacoApi,
      lightPalette,
      darkPalette,
      highlightColors,
    );
    return;
  }

  monacoApi.editor.defineTheme("vs-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: readerThemeEditorColors(darkPalette, "dark"),
  });
  monacoApi.editor.defineTheme("vs", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: readerThemeEditorColors(lightPalette, "light"),
  });
}

/**
 * 构建章节标题的 Monaco 模型装饰（仅 `inlineClassName` 着色）。
 * 标题前后留白由阅读器 `changeViewZones` 管理，勿在此处设置 `lineHeight`。
 */
export function buildChapterTitleDecorations(
  monacoApi: typeof import("monaco-editor"),
  model: monaco.editor.ITextModel,
  chapters: ChapterStickyLine[],
): monaco.editor.IModelDeltaDecoration[] {
  const sorted = chapters.slice().sort((a, b) => a.lineNumber - b.lineNumber);
  const maxLine = model.getLineCount();
  return sorted
    .map((ch) => ch.lineNumber)
    .filter((lineNumber) => lineNumber >= 1 && lineNumber <= maxLine)
    .map((lineNumber) => ({
      range: new monacoApi.Range(
        lineNumber,
        1,
        lineNumber,
        model.getLineMaxColumn(lineNumber),
      ),
      options: {
        inlineClassName: CHAPTER_TITLE_LINE_CLASS,
      },
    }));
}

/**
 * 小地图章节标题（Monaco `sectionHeaderText`，同 VS Code 小地图节标题）。
 * 与 {@link buildChapterTitleDecorations} 分离：编辑态不加行内 scale 样式。
 */
export function buildChapterMinimapSectionHeaderDecorations(
  monacoApi: typeof import("monaco-editor"),
  model: monaco.editor.ITextModel,
  chapters: ChapterStickyLine[],
): monaco.editor.IModelDeltaDecoration[] {
  const maxLine = model.getLineCount();
  return chapters
    .filter(
      (ch) =>
        ch.title.trim().length > 0 &&
        ch.lineNumber >= 1 &&
        ch.lineNumber <= maxLine,
    )
    .map((ch) => ({
      range: new monacoApi.Range(ch.lineNumber, 1, ch.lineNumber, 1),
      options: {
        description: "chapter-minimap-section-header",
        minimap: {
          color: undefined,
          position: monacoApi.editor.MinimapPosition.Inline,
          sectionHeaderStyle: monacoApi.editor.MinimapSectionHeaderStyle.Normal,
          sectionHeaderText: ch.title,
        },
      },
    }));
}

export type MarkdownLinkHit = { range: monaco.Range; url: string };

export function buildMarkdownDecorations(
  monacoApi: typeof import("monaco-editor"),
  model: monaco.editor.ITextModel,
  outMarkdownLinkHits?: MarkdownLinkHit[],
): monaco.editor.IModelDeltaDecoration[] {
  const decorations: monaco.editor.IModelDeltaDecoration[] = [];

  const linkMatches = model.findMatches("(?:\\\\)?\\[(.*?)(?:\\\\)?\\](?:\\\\)?\\((.*?)(?:\\\\)?\\)", false, true, false, null, true);
  for (const match of linkMatches) {
    const text = model.getValueInRange(match.range);
    const localRe = /^(?:\\)?\[(.*?)(?:\\)?\](?:\\)?\((.*?)(?:\\)?\)$/;
    const m = localRe.exec(text);
    if (m) {
      const linkText = m[1];
      const urlText = m[2];
      
      const startOffset = model.getOffsetAt(match.range.getStartPosition());
      const bracketStartLen = text.startsWith('\\[') ? 2 : 1;
      
      const textStartPos = model.getPositionAt(startOffset + bracketStartLen);
      const textEndPos = model.getPositionAt(startOffset + bracketStartLen + linkText.length);
      
      const bracketStart = new monacoApi.Range(
        match.range.startLineNumber,
        match.range.startColumn,
        textStartPos.lineNumber,
        textStartPos.column
      );
      const textRange = new monacoApi.Range(
        textStartPos.lineNumber,
        textStartPos.column,
        textEndPos.lineNumber,
        textEndPos.column
      );
      const urlRange = new monacoApi.Range(
        textEndPos.lineNumber,
        textEndPos.column,
        match.range.endLineNumber,
        match.range.endColumn
      );

      decorations.push({ range: bracketStart, options: { inlineClassName: "txtr-md-marker" } });
      decorations.push({ range: textRange, options: { inlineClassName: "readerEbookInternalLink", hoverMessage: { value: "外部链接" } } });
      decorations.push({ range: urlRange, options: { inlineClassName: "txtr-md-marker" } });
      
      if (outMarkdownLinkHits) {
        const urlMatch = text.match(/\(([^)]+)\)$/);
        const url = urlMatch ? urlMatch[1].trim() : "";
        outMarkdownLinkHits.push({ range: textRange, url });
      }
    }
  }


  const listMatches = model.findMatches("^\\s*[*\\-]\\s+", false, true, false, null, true);
  for (const match of listMatches) {
    const text = model.getValueInRange(match.range);
    const markerIndex = text.search(/[*\\-]/);
    if (markerIndex !== -1) {
      let spaceCount = 0;
      for (let i = 0; i < markerIndex; i++) {
        spaceCount += text[i] === '\t' ? 4 : 1;
      }
      
      let levelClass = "txtr-md-list-marker";
      if (spaceCount >= 6) {
        levelClass = "txtr-md-list-marker-l2";
      } else if (spaceCount >= 2) {
        levelClass = "txtr-md-list-marker-l1";
      }

      const markerColumn = match.range.startColumn + markerIndex;
      const markerRange = new monacoApi.Range(
        match.range.startLineNumber,
        markerColumn,
        match.range.startLineNumber,
        markerColumn + 1
      );
      decorations.push({ range: markerRange, options: { inlineClassName: levelClass } });
    }
  }
  
  const boldMatches = model.findMatches("\\*\\*(.*?)\\*\\*", false, true, false, null, true);
  for (const match of boldMatches) {
    const startRange = new monacoApi.Range(match.range.startLineNumber, match.range.startColumn, match.range.startLineNumber, match.range.startColumn + 2);
    const textRange = new monacoApi.Range(match.range.startLineNumber, match.range.startColumn + 2, match.range.endLineNumber, match.range.endColumn - 2);
    const endRange = new monacoApi.Range(match.range.endLineNumber, match.range.endColumn - 2, match.range.endLineNumber, match.range.endColumn);
    
    decorations.push({ range: startRange, options: { inlineClassName: "txtr-md-marker" } });
    decorations.push({ range: textRange, options: { inlineClassName: "txtr-md-bold" } });
    decorations.push({ range: endRange, options: { inlineClassName: "txtr-md-marker" } });
  }

  const italicMatches = model.findMatches("\\*([^\\*]+)\\*", false, true, false, null, true);
  for (const match of italicMatches) {
    const isOverlapping = boldMatches.some(bm => {
      if (bm.range.startLineNumber !== match.range.startLineNumber) return false;
      return bm.range.startColumn <= match.range.endColumn && bm.range.endColumn >= match.range.startColumn;
    });
    if (isOverlapping) continue;

    const startRange = new monacoApi.Range(match.range.startLineNumber, match.range.startColumn, match.range.startLineNumber, match.range.startColumn + 1);
    const textRange = new monacoApi.Range(match.range.startLineNumber, match.range.startColumn + 1, match.range.endLineNumber, match.range.endColumn - 1);
    const endRange = new monacoApi.Range(match.range.endLineNumber, match.range.endColumn - 1, match.range.endLineNumber, match.range.endColumn);
    
    decorations.push({ range: startRange, options: { inlineClassName: "txtr-md-marker" } });
    decorations.push({ range: textRange, options: { inlineClassName: "txtr-md-italic" } });
    decorations.push({ range: endRange, options: { inlineClassName: "txtr-md-marker" } });
  }

  const blockquoteMatches = model.findMatches("^\\s*>\\s*(.*)$", false, true, false, null, true);
  const blockquoteLineNumbers = new Set(blockquoteMatches.map(m => m.range.startLineNumber));

  for (const match of blockquoteMatches) {
    const text = model.getValueInRange(match.range);
    const markerMatch = text.match(/^(\s*>\s*)/);
    if (markerMatch) {
      const markerLen = markerMatch[1].length;
      const lineNumber = match.range.startLineNumber;
      
      const markerRange = new monacoApi.Range(
        lineNumber,
        match.range.startColumn,
        lineNumber,
        match.range.startColumn + markerLen
      );
      decorations.push({ range: markerRange, options: { inlineClassName: "txtr-md-marker" } });
      
      const textRange = new monacoApi.Range(
        lineNumber,
        match.range.startColumn + markerLen,
        lineNumber,
        match.range.endColumn
      );
      if (!textRange.isEmpty()) {
        decorations.push({ range: textRange, options: { inlineClassName: "txtr-md-blockquote" } });
      }

      const isTop = !blockquoteLineNumbers.has(lineNumber - 1);
      const isBottom = !blockquoteLineNumbers.has(lineNumber + 1);
      
      let classNames = "txtr-md-blockquote-line";
      if (isTop) classNames += " txtr-md-blockquote-top";
      if (isBottom) classNames += " txtr-md-blockquote-bottom";

      decorations.push({
        range: new monacoApi.Range(lineNumber, 1, lineNumber, 1),
        options: {
          isWholeLine: true,
          className: classNames
        }
      });
    }
  }

  const inlineCodeMatches = model.findMatches("`([^`]+)`", false, true, false, null, true);
  for (const match of inlineCodeMatches) {
    const text = model.getValueInRange(match.range);
    if (text.startsWith("```") || text.endsWith("```")) continue;

    const startRange = new monacoApi.Range(match.range.startLineNumber, match.range.startColumn, match.range.startLineNumber, match.range.startColumn + 1);
    const textRange = new monacoApi.Range(match.range.startLineNumber, match.range.startColumn + 1, match.range.endLineNumber, match.range.endColumn - 1);
    const endRange = new monacoApi.Range(match.range.endLineNumber, match.range.endColumn - 1, match.range.endLineNumber, match.range.endColumn);
    
    decorations.push({ range: startRange, options: { inlineClassName: "txtr-md-marker" } });
    decorations.push({ range: textRange, options: { inlineClassName: "txtr-md-code-block" } });
    decorations.push({ range: endRange, options: { inlineClassName: "txtr-md-marker" } });
  }

  const codeBlockMarkers = model.findMatches("^\\s*```", false, true, false, null, true);
  for (let i = 0; i < codeBlockMarkers.length; i += 2) {
    if (i + 1 < codeBlockMarkers.length) {
      const startMatch = codeBlockMarkers[i];
      const endMatch = codeBlockMarkers[i + 1];
      const startLine = startMatch.range.startLineNumber;
      const endLine = endMatch.range.startLineNumber;
      
      const startRange = new monacoApi.Range(startLine, 1, startLine, model.getLineMaxColumn(startLine));
      const endRange = new monacoApi.Range(endLine, 1, endLine, model.getLineMaxColumn(endLine));
      
      decorations.push({ range: startRange, options: { inlineClassName: "txtr-md-marker" } });
      decorations.push({ range: endRange, options: { inlineClassName: "txtr-md-marker" } });
      
      if (endLine > startLine + 1) {
        const textRange = new monacoApi.Range(
          startLine + 1,
          1,
          endLine - 1,
          model.getLineMaxColumn(endLine - 1)
        );
        decorations.push({ range: textRange, options: { inlineClassName: "txtr-md-code-block" } });
      }

      for (let line = startLine; line <= endLine; line++) {
        const isTop = line === startLine;
        const isBottom = line === endLine;
        
        let classNames = "txtr-md-code-block-line";
        if (isTop) classNames += " txtr-md-code-block-top";
        if (isBottom) classNames += " txtr-md-code-block-bottom";

        decorations.push({
          range: new monacoApi.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: classNames
          }
        });
      }
    }
  }

  const hrMatches = model.findMatches("^\\s*([-*_])(?:\\s*\\1){2,}\\s*$", false, true, false, null, true);
  for (const match of hrMatches) {
    const lineNumber = match.range.startLineNumber;
    
    decorations.push({
      range: new monacoApi.Range(
        lineNumber,
        1,
        lineNumber,
        model.getLineMaxColumn(lineNumber)
      ),
      options: { inlineClassName: "txtr-md-marker" }
    });

    decorations.push({
      range: new monacoApi.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        className: "txtr-md-hr-line"
      }
    });
  }

  return decorations;
}
