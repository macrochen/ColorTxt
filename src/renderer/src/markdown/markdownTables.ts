import { marked } from "../utils/aiMarkdownMarkedSetup";

function hasTableOrMath(token: any): boolean {
  if (token.type === "table" || token.type === "blockKatex") {
    return true;
  }
  if (token.tokens) {
    return token.tokens.some(
      (t: any) =>
        t.type === "inlineKatex" || t.type === "blockKatex" || hasTableOrMath(t)
    );
  }
  return false;
}

/**
 * Parses Markdown tables and math formulas using marked.lexer and replaces the raw lines with
 * anchor lines to maintain the exact line count.
 * The first line becomes `<<TABLE:base64-raw-markdown>>`, and subsequent lines
 * become `<<TABLE_ROW>>`. These lines will be deleted and replaced with ViewZones.
 */
export function expandMarkdownTablesInPlainText(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const tokens = marked.lexer(normalized);
  
  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (hasTableOrMath(token)) {
      // Encode the entire raw markdown block to base64
      const b64 = btoa(encodeURIComponent(token.raw));
      
      // Preserve the exact line count to not break Monaco line mappings.
      const rawLines = token.raw.split("\n");
      const isLastEmpty = rawLines[rawLines.length - 1] === "";
      const effectiveLineCount = isLastEmpty ? rawLines.length - 1 : rawLines.length;
      
      let replacement = `<<TABLE:${b64}>>`;
      for (let j = 1; j < effectiveLineCount; j++) {
        replacement += "\n<<TABLE_ROW>>";
      }
      
      // If the original token had a trailing newline, preserve it
      if (isLastEmpty) {
        replacement += "\n";
      }
      
      out += replacement;
    } else {
      let raw = token.raw;
      // 清除 Markdown 链接，将 [文字](链接) 替换为纯文字
      // 支持可能存在的转义字符，如 \[文字\]\(链接\)
      raw = raw.replace(/(?:\\)?\[(.*?)(?:\\)?\](?:\\)?\((.*?)(?:\\)?\)/g, "$1");
      out += raw;
    }
  }
  
  return out;
}
