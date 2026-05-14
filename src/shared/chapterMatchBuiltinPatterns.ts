/**
 * 章节匹配「内置三条」的 pattern 与默认示例。
 * 与 `renderer/src/chapter.ts` 中内置规则同源；技能文案等引用此处以保证一致。
 */

/** 章节序号中的数字字符类：简/繁大写、俗写、半角与全角阿拉伯（与内置主规则数字段同源） */
export const CHAPTER_MATCH_NUMERAL_CHAR_CLASS =
  "零一二三四五六七八九十百千万两〇壹贰叁肆伍陆柒捌玖拾廿卅卌佰皕仟萬0-9０-９";

const cnNumClass = CHAPTER_MATCH_NUMERAL_CHAR_CLASS;
const unitClass = "章回卷节集部篇";

/** 主规则：第 + 中文/阿拉伯/全角数字 + 章回卷节… + 可选副标题（有界） */
export const CHAPTER_MATCH_BUILTIN_MAIN_PATTERN = `^\\s*(第[${cnNumClass}]{1,12}[${unitClass}])\\s*(.{0,40})\\s*$`;

export const CHAPTER_MATCH_BUILTIN_ALT_PATTERN =
  "^\\s*(序章|楔子|引子|尾声|后记|番外|完结感言)\\s*(.{0,40})\\s*$";

/** 数字顿号序号章节，如「1、章节名」；应用内默认第二条为 alt、第三条为本条且默认未启用 */
export const CHAPTER_MATCH_BUILTIN_NUM_ORDERED_PATTERN =
  "^\\s*(\\d+、)\\s*(.{0,40})\\s*$";

export const CHAPTER_MATCH_BUILTIN_MAIN_EXAMPLES: readonly string[] = [
  "第一回 风月无情",
  "第一章 标题",
  "第1章",
  "第十回 标题",
  "第二卷 标题",
];

export const CHAPTER_MATCH_BUILTIN_ALT_EXAMPLES: readonly string[] = [
  "序章",
  "番外 标题",
  "后记",
];

export const CHAPTER_MATCH_BUILTIN_NUM_ORDERED_EXAMPLES: readonly string[] = [
  "1、标题",
  "0001、标题",
  "1、",
];

/** 注入「章节匹配规则」技能，供模型对照内置默认结构 */
export function chapterMatchBuiltinReferenceBlock(): string {
  const joinEx = (xs: readonly string[]) => xs.join("；");
  return `## 应用内置默认三条（与「章节匹配规则」设置里内置项同源）

以下 **内置匹配规则（一行）与示例** 与软件在未改内置时的默认值一致，仅供你**对照结构**（\`^\\s*\` / \`\\s*$\`、**有副标题时**两组捕获与第二组 \`.{0,40}\` 等有界写法）；**不是**要求你照抄输出。**内置第 1 条仅适用于原文行里确有「第」且带「章/回/卷…」等单位的行**；若用户示例仅为「一」「十一」等**无「第」、无单位字**，**禁止**把本条照抄成最终匹配规则——应改走技能正文「特殊场景 · 无章节名」或「纯数字 + 空格 + 标题」，除非 **ragSearch** 证明全书章节头实为「第…」式。章回体常见「第N回」时，多数情况用户**启用第一条内置**即可，勿重复造轮子。

### 1. 主规则（第×章 / 回 / 卷 / 节…）
\`\`\`
${CHAPTER_MATCH_BUILTIN_MAIN_PATTERN}
\`\`\`
应用默认示例行：${joinEx(CHAPTER_MATCH_BUILTIN_MAIN_EXAMPLES)}

**量词（勿改）**：上式在「第」与「章/回…」单位之间的数字字符类**紧后面**的量词**必须**为 **\`{1,12}\`**（花括号内是数字 **1**、逗号、数字 **12**，共五个字符），**禁止**写成 **\`{1,2}\`**、**\`{1,3}\`**。含义是**至多 12 个数字字符**（每个中文数字或每个阿拉伯数字各算一个字符），**不是**「阿拉伯两位整数」；例如「第十七」在字类下常占 **3** 个字符，\`{1,2}\` 会配不全整段序号。

### 2. 特殊章节名（序章、楔子、番外…）
\`\`\`
${CHAPTER_MATCH_BUILTIN_ALT_PATTERN}
\`\`\`
应用默认示例行：${joinEx(CHAPTER_MATCH_BUILTIN_ALT_EXAMPLES)}

### 3. 数字顿号序号（应用内该内置规则默认**未启用**）
\`\`\`
${CHAPTER_MATCH_BUILTIN_NUM_ORDERED_PATTERN}
\`\`\`
应用默认示例行：${joinEx(CHAPTER_MATCH_BUILTIN_NUM_ORDERED_EXAMPLES)}`;
}
