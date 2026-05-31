import type * as monaco from "monaco-editor";
import { marked } from "../utils/aiMarkdownMarkedSetup";

export const READER_TABLE_ANCHOR_LINE_RE = /^\s*<<TABLE:([^>]+)>>\s*$/;
export const READER_TABLE_ROW_LINE_RE = /^\s*<<TABLE_ROW>>\s*$/;

export type ReplaceTableAnchorsResult = {
  zoneIds: string[];
  deletedOriginalLineNumbersDesc: number[];
  setHighlight: (line: number, active: boolean) => void;
};

function lineDeleteRange(
  monacoApi: typeof monaco,
  model: monaco.editor.ITextModel,
  line: number,
): monaco.Range {
  const lc = model.getLineCount();
  if (line < 1 || line > lc) {
    return new monacoApi.Range(1, 1, 1, 1);
  }
  if (lc === 1) {
    return new monacoApi.Range(1, 1, 1, model.getLineMaxColumn(1));
  }
  if (line < lc) {
    return new monacoApi.Range(line, 1, line + 1, 1);
  }
  const prev = line - 1;
  return new monacoApi.Range(
    prev,
    model.getLineMaxColumn(prev),
    line,
    model.getLineMaxColumn(line),
  );
}

function syncReaderTableViewZoneBox(
  editor: monaco.editor.IStandaloneCodeEditor,
  dom: HTMLElement,
): void {
  const { contentWidth } = editor.getLayoutInfo();
  dom.style.width = `${Math.max(0, contentWidth - 14)}px`;
}

export async function replaceTableAnchorLinesWithViewZones(
  monacoApi: typeof monaco,
  editor: monaco.editor.IStandaloneCodeEditor,
  options: {
    onZonesChange?: (zoneIds: string[]) => void;
  },
): Promise<ReplaceTableAnchorsResult> {
  const model = editor.getModel();
  if (!model) return { zoneIds: [], deletedOriginalLineNumbersDesc: [] };
  const doc = model;

  const matches: { line: number; payload: string }[] = [];
  const rowMatches: number[] = [];
  
  const lc0 = doc.getLineCount();
  for (let L = 1; L <= lc0; L++) {
    const line = doc.getLineContent(L);
    const m = line.match(READER_TABLE_ANCHOR_LINE_RE);
    if (m?.[1]?.trim()) {
      matches.push({ line: L, payload: m[1].trim() });
    } else if (READER_TABLE_ROW_LINE_RE.test(line)) {
      rowMatches.push(L);
    }
  }

  if (matches.length === 0 && rowMatches.length === 0) {
    return { zoneIds: [], deletedOriginalLineNumbersDesc: [] };
  }

  const allDeletedLines = [...matches.map((x) => x.line), ...rowMatches].sort(
    (a, b) => b - a,
  );

  const deletedOriginalLineNumbersDesc = [...allDeletedLines];
  const tableLineSet = new Set(allDeletedLines);



  function afterLineNumberForMatch(match: { line: number }): number {
    let k = match.line - 1;
    while (k >= 1 && tableLineSet.has(k)) {
      k -= 1;
    }
    if (k < 1) return 0;
    return k;
  }

  const zoneSpecs: { afterLineNumber: number; html: string; rawMarkdown: string }[] = [];
  for (const m of matches.slice().sort((a, b) => a.line - b.line)) {
    try {
      const rawMarkdown = decodeURIComponent(atob(m.payload));
      const html = await marked.parse(rawMarkdown, { breaks: true, async: true });
      zoneSpecs.push({
        afterLineNumber: afterLineNumberForMatch(m),
        html,
        rawMarkdown,
      });
    } catch (e) {
      console.warn("Failed to parse markdown table payload", e);
    }
  }

  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
  // doc.applyEdits(edits);

  const zoneIds: string[] = [];
  let zoneOrdinal = 10000;
  const lineDoms = new Map<number, HTMLElement>();
  
  editor.changeViewZones((accessor) => {
    for (const z of zoneSpecs) {
      const afterLineNumber = z.afterLineNumber;
      const afterColumn =
        afterLineNumber > 0 ? doc.getLineMaxColumn(afterLineNumber) : undefined;
      
      const dom = document.createElement("div");
      dom.className = "readerTableViewZone";
      dom.style.boxSizing = "border-box";
      dom.style.display = "block";
      // Let the content determine the height
      dom.style.overflow = "auto";
      dom.style.padding = "10px 0";
      syncReaderTableViewZoneBox(editor, dom);
      
      const wrapper = document.createElement("div");
      wrapper.className = "readerTableViewZoneWrapper";
      wrapper.innerHTML = z.html;
      
      const fontInfo = editor.getOptions().get(monacoApi.editor.EditorOption.fontInfo);
      if (fontInfo) {
        wrapper.style.fontFamily = fontInfo.fontFamily;
        wrapper.style.fontSize = `${fontInfo.fontSize}px`;
        wrapper.style.lineHeight = `${fontInfo.lineHeight}px`;
        wrapper.style.fontWeight = fontInfo.fontWeight;
        wrapper.style.color = "var(--vscode-editor-foreground)";
      }
      
      // Remove hardcoded padding if it's just a math formula
      if (!z.rawMarkdown.includes("|")) {
        dom.style.padding = "0";
      }

      dom.appendChild(wrapper);

      // We need to measure the height of the DOM element before adding the zone,
      // or we use a fixed height and update it via layout?
      // Monaco allows setting heightInPx. But we don't know the height yet.
      // A common workaround is to render the DOM node off-screen to measure height.
      document.body.appendChild(dom);
      const computedHeight = dom.getBoundingClientRect().height;
      document.body.removeChild(dom);
      
      // Minimum height for small tables, plus padding
      const finalHeight = Math.max(50, computedHeight);

      const id = accessor.addZone({
        afterLineNumber,
        afterColumn,
        ordinal: zoneOrdinal++,
        heightInPx: finalHeight,
        domNode: dom,
        showInHiddenAreas: true,
        onDomNodeTop: () => {
          syncReaderTableViewZoneBox(editor, dom);
        },
      });
      zoneIds.push(id);
      
      // Save the DOM so we can highlight it
      for (const m of matches) {
        if (afterLineNumberForMatch(m) === z.afterLineNumber) {
          lineDoms.set(m.line, dom);
        }
      }
      for (const row of rowMatches) {
        if (afterLineNumberForMatch({ line: row }) === z.afterLineNumber) {
          lineDoms.set(row, dom);
        }
      }
    }
  });
  
  const setHighlight = (line: number, active: boolean) => {
    const dom = lineDoms.get(line);
    if (dom) {
      if (active) {
        dom.classList.add("readerVoiceReadCurrentLine");
      } else {
        dom.classList.remove("readerVoiceReadCurrentLine");
      }
    }
  };
  
  options.onZonesChange?.(zoneIds);
  return { zoneIds, deletedOriginalLineNumbersDesc, setHighlight };
}
