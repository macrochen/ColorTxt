/**
 * AI 正文里的章节跳转标记解析与展示。
 * **推荐**模型输出 `（ch=N）`（全角括号 + 半角 `ch=`），以免形如 `[...](ch=N)` 被 Markdown 误解析为链接；
 * 下列 pattern 仍解析半角 `(ch=N)`、`[ch=N]`、`(ch=标识: N)` 等，兼容历史会话与旧模型输出。
 *
 * **N** = 全书章节 **chapterIndex（从 0 起）**，首章为 `（ch=0）`；展示跳转按钮时由界面换算为「第 N+1 章」。
 * 兼容模型把多章写在一对括号内：`（ch=1, ch=2）` 会先归一化为 `（ch=1）（ch=2）` 再解析。
 */

/**
 * 将 `（ch=a, ch=b）` / `(ch=a，ch=b)` 等合并写法拆成多个标准 `（ch=N）`，便于现有正则命中。
 * 输出统一为全角括号包裹的独立标记。
 */
export function normalizeCompoundAiChapterMarkers(md: string): string {
  const eq = "[=\\uFF1D]";
  const atom = `ch\\s*${eq}\\s*\\d+`;
  const re = new RegExp(
    `(?:\\uFF08|\\()\\s*(${atom}(?:\\s*[,，]\\s*${atom})+)\\s*(?:\\uFF09|\\))`,
    "g",
  );
  const pick = new RegExp(`ch\\s*${eq}\\s*(\\d+)`, "g");
  return md.replace(re, (full, inner: string) => {
    const nums = [...inner.matchAll(pick)].map((m) => m[1]!);
    return nums.length > 0 ? nums.map((n) => `（ch=${n}）`).join("") : full;
  });
}

/** Markdown 与 marked 后 HTML 文本节点共用（含全角括号、半角括号、`[ch=N]`、`(ch=标识: N)` 等兼容） */
export function createAiChapterMarkerRegex(): RegExp {
  const open = "(?:\\(|\\uFF08)";
  const close = "(?:\\)|\\uFF09)";
  const eq = "[=\\uFF1D]";
  return new RegExp(
    `${open}ch${eq}(\\d+)${close}` +
      `|\\[ch${eq}(\\d+)\\]` +
      `|${open}ch[^:：)\\uFF09]+[:：]\\s*(\\d+)${close}` +
      "|\\[ch[^:：\\]]+[:：]\\s*(\\d+)\\]",
    "g",
  );
}

export function chapterNumStrFromMarkerMatch(m: RegExpExecArray): string {
  return (m[1] ?? m[2] ?? m[3] ?? m[4])!;
}

/** 展示 / 导出 / 复制前：拆分括号内多章标记等 */
export function normalizeAiChapterRefMarkers(md: string): string {
  return normalizeCompoundAiChapterMarkers(md);
}
