/**
 * Marked 对「东亚文字直接贴着 `**`」的加粗识别很挑剔（参见 https://marked.js.org/demo/ ）：
 * 例如 `在**《标题》**` 常无法配对，而 `在 **《标题》**`、`）** 的` 等外侧有空格时更容易生效。
 * 无内置开关可放宽；此处对正文做保守启发式补空格。
 */

const CJK_OR_FW =
  "\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef";

/** 与 marked strong 相邻时需要外侧空格的一侧字符（CJK / 全角区 / 字母数字） */
const STRONG_OUTSIDE_BOUNDARY = new RegExp(
  `[${CJK_OR_FW}0-9A-Za-z]`,
  "u",
);

/** 全角 `＊` → `*`，否则无法作为 Markdown 定界符 */
export function normalizeMarkdownAsterisks(raw: string): string {
  return raw.replace(/\uFF0A/g, "*");
}

/**
 * 为成对 `**` 的外侧补足空格，便于 marked 识别 strong（CJK 紧贴 `**` 时常失效）。
 * 按「开口 / 闭口」交替处理，避免旧版「CJK+**+一字」在开口侧误插入 `** 首字` 破坏加粗区间。
 */
export function ensureMarkedStrongDelimiterSpacing(raw: string): string {
  let result = "";
  let i = 0;
  let inStrong = false;

  while (i < raw.length) {
    if (i + 1 < raw.length && raw[i] === "*" && raw[i + 1] === "*") {
      const beforeCh = result.length > 0 ? result[result.length - 1]! : "";
      const afterClosePeek = raw[i + 2] ?? "";

      if (!inStrong) {
        if (
          beforeCh &&
          !/\s/.test(beforeCh) &&
          STRONG_OUTSIDE_BOUNDARY.test(beforeCh)
        ) {
          result += " ";
        }
        result += "**";
        inStrong = true;
      } else {
        result += "**";
        inStrong = false;
        if (
          afterClosePeek &&
          !/\s/.test(afterClosePeek) &&
          STRONG_OUTSIDE_BOUNDARY.test(afterClosePeek)
        ) {
          result += " ";
        }
      }
      i += 2;
      continue;
    }
    result += raw[i]!;
    i++;
  }
  return result;
}
