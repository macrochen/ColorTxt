import { marked } from "../utils/aiMarkdownMarkedSetup";

/**
 * Parses Markdown tables using marked.lexer and replaces the raw lines with
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
    if (token.type === "table") {
      // Encode the entire raw markdown table to base64
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
      out += token.raw;
    }
  }
  
  return out;
}
