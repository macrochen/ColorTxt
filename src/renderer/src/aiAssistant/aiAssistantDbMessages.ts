import type { AIChatToolCall } from "@shared/aiTypes";
import type {
  DbMsgRow,
  UiAssistantSegment,
  UiMsg,
  UiToolEntry,
} from "./aiAssistantTypes";

/** 与主进程 `previewJson(args, 400)` 一致，用于历史会话还原工具请求摘要 */
function argsPreviewFromStoredArguments(
  argumentsJson: string,
  maxLen = 400,
): string {
  const raw = argumentsJson ?? "";
  try {
    const obj = JSON.parse(raw || "{}") as unknown;
    const s = JSON.stringify(obj);
    return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
  } catch {
    const t = raw.trim();
    if (!t) return "";
    return t.length <= maxLen ? t : `${t.slice(0, maxLen)}…`;
  }
}

function parseStoredToolCalls(
  json: string | null | undefined,
): AIChatToolCall[] {
  if (!json?.trim()) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: AIChatToolCall[] = [];
    for (const x of arr) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : "";
      const fn = o.function;
      if (!fn || typeof fn !== "object") continue;
      const f = fn as Record<string, unknown>;
      const name = typeof f.name === "string" ? f.name : "";
      const args = typeof f.arguments === "string" ? f.arguments : "";
      if (!id) continue;
      out.push({
        id,
        type: "function",
        function: { name, arguments: args },
      });
    }
    return out;
  } catch {
    return [];
  }
}

function argsPreviewForToolCallId(
  calls: AIChatToolCall[],
  toolCallId: string,
): string {
  const tc = calls.find((c) => c.id === toolCallId);
  if (!tc) return "";
  return argsPreviewFromStoredArguments(tc.function.arguments);
}

function parsePayloadReasoning(payload: string | null | undefined): string {
  if (!payload?.trim()) return "";
  try {
    const o = JSON.parse(payload) as { reasoning?: string };
    return typeof o.reasoning === "string" ? o.reasoning : "";
  } catch {
    return "";
  }
}

/** 旧版持久化把「用户取消了生成」拼进正文；界面另有 aborted 横幅，加载时去掉尾缀以免重复 */
function stripStoredAssistantAbortMarker(
  content: string,
  aborted: boolean,
): string {
  if (!aborted || !content.trim()) return content;
  return content.replace(/(?:\r?\n)*用户取消了生成\s*$/u, "").trimEnd();
}

/**
 * 中止等场景下曾用 `assistantPlainText` 把整段写入一条 assistant 的 `content`，
 * `payload` 无 reasoning 时思考会落在正文里；据此拆回「思考」与剩余片段（与 `rowsToUiMessages` 展示一致）。
 *
 * `aborted === true` 且正文内无「【工具」段时：思考草稿里常有多个 `\n\n`，不得以首个空行当成思考/回答分界，
 * 应将 `【思考】` 后的整段视为推理正文。
 */
function parseLegacyAssistantPlainBlob(
  content: string,
  aborted: boolean,
): {
  reasoning: string;
  tail: string;
} {
  const t = content.trimStart();
  const marker = "【思考】";
  if (!t.startsWith(marker)) {
    return { reasoning: "", tail: content };
  }
  let pos = marker.length;
  if (t[pos] === "\r") pos++;
  if (t[pos] === "\n") pos++;
  const afterThink = t.slice(pos);
  const toolHeader = /\r?\n【工具[^\n]*】/;
  const m = toolHeader.exec(afterThink);
  if (m?.index != null && m.index >= 0) {
    return {
      reasoning: afterThink.slice(0, m.index).trimEnd(),
      tail: afterThink.slice(m.index).trimStart(),
    };
  }
  if (aborted) {
    return {
      reasoning: afterThink.trimEnd(),
      tail: "",
    };
  }
  const paraBreak = /\r?\n\r?\n/;
  const pb = paraBreak.exec(afterThink);
  if (pb?.index != null && pb.index >= 0) {
    return {
      reasoning: afterThink.slice(0, pb.index).trimEnd(),
      tail: afterThink.slice(pb.index + pb[0].length).trimEnd(),
    };
  }
  return {
    reasoning: afterThink.trimEnd(),
    tail: "",
  };
}

export function rowsToUiMessages(rows: DbMsgRow[]): UiMsg[] {
  const out: UiMsg[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i]!;
    if (r.role === "user") {
      out.push({
        id: r.id,
        role: "user",
        content: r.content,
        aborted: r.aborted,
        createdAt: r.createdAt,
      });
      i++;
      continue;
    }
    if (r.role === "assistant") {
      const hasTools = Boolean(r.toolCallsJson?.trim());
      const reasoning = parsePayloadReasoning(r.payload);
      if (hasTools) {
        const tools: UiToolEntry[] = [];
        const segments: UiAssistantSegment[] = [];
        let pendingThink = reasoning.trim();
        /** 当前一轮「待执行」的 tool_calls，来自最近一条带 toolCallsJson 的 assistant */
        let pendingToolCalls = parseStoredToolCalls(r.toolCallsJson);
        let j = i + 1;
        let mergedFinal = false;
        while (j < rows.length) {
          const row = rows[j]!;
          if (row.role === "tool") {
            if (pendingThink) {
              segments.push({
                kind: "think",
                sealed: true,
                text: pendingThink,
                open: true,
              });
              pendingThink = "";
            }
            const snippetPreview =
              row.content.length > 360
                ? `${row.content.slice(0, 360)}…`
                : row.content;
            const tcId = row.toolCallId ?? "";
            tools.push({
              id: row.id,
              toolCallId: tcId,
              name: (row.toolName ?? "tool").trim() || "tool",
              argsPreview: argsPreviewForToolCallId(pendingToolCalls, tcId),
              status: "done",
              preview: snippetPreview,
              full: row.content,
              open: false,
            });
            segments.push({ kind: "toolRef", toolCallId: tcId });
            j++;
            continue;
          }
          if (row.role === "assistant" && row.toolCallsJson?.trim()) {
            pendingToolCalls = parseStoredToolCalls(row.toolCallsJson);
            const more = parsePayloadReasoning(row.payload);
            if (more.trim()) {
              pendingThink = pendingThink
                ? `${pendingThink}\n\n${more.trim()}`
                : more.trim();
            }
            j++;
            continue;
          }
          if (row.role === "assistant" && !row.toolCallsJson?.trim()) {
            if (pendingThink.trim()) {
              segments.push({
                kind: "think",
                sealed: true,
                text: pendingThink.trim(),
                open: true,
              });
            }
            const mergedAborted = row.aborted ?? r.aborted;
            let answerRaw = row.content;
            if (!pendingThink.trim()) {
              const leg = parseLegacyAssistantPlainBlob(
                row.content,
                Boolean(mergedAborted),
              );
              if (leg.reasoning.trim()) {
                segments.push({
                  kind: "think",
                  sealed: true,
                  text: leg.reasoning.trim(),
                  open: false,
                });
                answerRaw = leg.tail;
              }
            }
            out.push({
              id: row.id,
              role: "assistant",
              segments,
              tools,
              answer: stripStoredAssistantAbortMarker(
                answerRaw,
                Boolean(mergedAborted),
              ),
              createdAt: row.createdAt,
              aborted: mergedAborted,
            });
            i = j + 1;
            mergedFinal = true;
            break;
          }
          break;
        }
        if (!mergedFinal) {
          if (pendingThink.trim()) {
            segments.push({
              kind: "think",
              sealed: true,
              text: pendingThink.trim(),
              open: true,
            });
          }
          out.push({
            id: r.id,
            role: "assistant",
            segments,
            tools,
            answer: "",
            createdAt: r.createdAt,
            aborted: r.aborted,
          });
          i = j;
        }
        continue;
      }
      let reasoningText = reasoning.trim();
      let answerRaw = r.content;
      let thinkOpen = true;
      if (!reasoningText) {
        const leg = parseLegacyAssistantPlainBlob(
          r.content,
          Boolean(r.aborted),
        );
        if (leg.reasoning.trim()) {
          reasoningText = leg.reasoning.trim();
          answerRaw = leg.tail;
          thinkOpen = false;
        }
      }
      out.push({
        id: r.id,
        role: "assistant",
        segments: reasoningText
          ? [
              {
                kind: "think",
                sealed: true,
                text: reasoningText,
                open: thinkOpen,
              },
            ]
          : [],
        tools: [],
        answer: stripStoredAssistantAbortMarker(answerRaw, Boolean(r.aborted)),
        createdAt: r.createdAt,
        aborted: r.aborted,
      });
      i++;
      continue;
    }
    if (r.role === "tool") {
      i++;
      continue;
    }
    i++;
  }
  return out;
}
