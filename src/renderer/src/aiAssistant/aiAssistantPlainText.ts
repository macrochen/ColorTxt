import type { UiMsg } from "./aiAssistantTypes";
import { allThinkingJoined } from "./aiAssistantSegments";

export function assistantAnswerMdSource(m: UiMsg): string {
  if (m.role !== "assistant") return "";
  return m.answer;
}

export function assistantPlainText(m: UiMsg): string {
  if (m.role === "user") {
    return [m.content.trim(), m.errorDetail?.trim() ?? ""]
      .filter(Boolean)
      .join("\n\n");
  }
  if (m.role !== "assistant") return "";
  const parts: string[] = [];
  const thinkJoined = allThinkingJoined(m);
  if (thinkJoined) parts.push(`【思考】\n${thinkJoined}`);
  for (const t of m.tools) {
    const head = `${t.name}${t.argsPreview ? ` ${t.argsPreview}` : ""}`;
    const body = (t.full || t.preview).trim();
    if (body) parts.push(`【工具 ${head}】\n${body}`);
    else parts.push(`【工具 ${head}】`);
  }
  const ans = m.answer.trim();
  if (ans) parts.push(ans);
  if (m.errorDetail?.trim()) parts.push(m.errorDetail.trim());
  return parts.filter(Boolean).join("\n\n");
}
