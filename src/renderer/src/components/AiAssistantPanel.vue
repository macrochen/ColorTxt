<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import type ReaderMain from "./ReaderMain.vue";
import type { Chapter } from "../chapter";
import { pickActiveChapterIdx } from "../reader/chapterIndex";
import type { AIChatStreamPayload, AIIndexSearchHit } from "@shared/aiTypes";
import { chunkNovelForAi } from "../utils/aiChunkBook";
import { hashBookBrowser } from "../utils/aiBookHash";
import { getCurrentChapterPlainText } from "../utils/currentChapterPlainText";
import { dirnameFs, joinFs } from "../ebook/pathUtils";
import AiMarkdown from "./AiMarkdown.vue";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import { icons } from "../icons";

const selectListsEmpty: CustomSelectItem[] = [];

type UiMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  aborted?: boolean;
  createdAt?: number;
};

const props = defineProps<{
  sessionFilePath: string | null;
  physicalReaderPath: string | null;
  chapters: Chapter[];
  activeChapterIdx: number;
  readerMainRef: InstanceType<typeof ReaderMain> | null;
}>();

const emit = defineEmits<{
  jumpToChapter: [chapter: Chapter];
}>();

const bookHash = ref("");
const threadId = ref<string | null>(null);
const messages = ref<UiMsg[]>([]);
const input = ref("");
const streaming = ref(false);
const activeRequestId = ref(0);
const deepThinking = ref(false);
const spoilerSafe = ref(false);
const historyOpen = ref(false);
const chatModelOptions = ref<string[]>([]);
const chatModelsLoading = ref(false);
/** 与设置里保存的 `chat.model` 对齐，用于判断是否传 `chatModelOverride` */
const savedConfigModel = ref("");
const activeChatModel = ref("");
const showJumpBottom = ref(false);
const threads = ref<Array<{ id: string; title: string; updatedAt: number }>>(
  [],
);

const indexPhase = ref<
  "idle" | "chunking" | "embedding" | "indexing" | "error"
>("idle");
const indexEmbedCurrent = ref(0);
const indexEmbedTotal = ref(0);
const indexError = ref("");

const listRef = ref<HTMLElement | null>(null);
const historyBtnRef = useTemplateRef<HTMLButtonElement>("historyBtnRef");
const exportBtnRef = useTemplateRef<HTMLButtonElement>("exportBtnRef");
const historyDropdownRef = ref<HTMLElement | null>(null);
const exportMenuOpen = ref(false);
const exportDropdownRef = ref<HTMLElement | null>(null);
const exportDropLeft = ref(0);
const exportDropTop = ref(0);
const exportDropWidth = ref(200);
const historyDropLeft = ref(0);
const historyDropTop = ref(0);
const historyDropWidth = ref(280);

const composerInputRef =
  useTemplateRef<HTMLTextAreaElement>("composerInputRef");

/** 输入区最大高度（px），超出后出现滚动条 */
const COMPOSER_INPUT_MAX_PX = 168;

function autosizeComposerInput() {
  const el = composerInputRef.value;
  if (!el) return;
  const maxPx = COMPOSER_INPUT_MAX_PX;
  /** 先折叠再测高度，避免沿用上一帧带滚动条时的 clientWidth 导致 scrollHeight 抖动 */
  el.style.overflow = "hidden";
  el.style.height = "0px";
  const natural = el.scrollHeight;
  const capped = Math.min(natural, maxPx);
  el.style.height = `${capped}px`;
  el.style.overflowY = natural > maxPx ? "auto" : "hidden";
}
const persistedChatRequests = new Set<number>();
watch(threadId, () => {
  persistedChatRequests.clear();
});
let offChunk: (() => void) | null = null;
let offDone: (() => void) | null = null;
let offErr: (() => void) | null = null;

const hasFile = computed(() =>
  Boolean(props.sessionFilePath && props.physicalReaderPath),
);

const chatModelScrollItems = computed((): CustomSelectItem[] => {
  const opts = chatModelOptions.value;
  const cur = activeChatModel.value.trim();
  const merged = cur && !opts.includes(cur) ? [cur, ...opts] : opts;
  return merged.map((m) => ({
    kind: "item",
    id: m,
    label: m,
  }));
});

function truncateModelLabel(raw: string, max = 28): string {
  const s = raw.trim();
  if (!s) return "选择模型…";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

const chatModelDisplayLabel = computed(() =>
  truncateModelLabel(activeChatModel.value),
);

async function syncChatModelFromConfig() {
  try {
    const cfg = await window.colorTxt.ai.configGet();
    savedConfigModel.value = cfg.chat.model.trim();
    activeChatModel.value = cfg.chat.model.trim();
  } catch {
    savedConfigModel.value = "";
    activeChatModel.value = "";
  }
}

async function refreshChatModels() {
  chatModelsLoading.value = true;
  try {
    const cfg = await window.colorTxt.ai.configGet();
    const r = await window.colorTxt.ai.modelsList({
      baseUrl: cfg.chat.baseUrl,
      apiKey: cfg.chat.apiKey,
    });
    if (r.ok) chatModelOptions.value = r.models;
    else chatModelOptions.value = [];
  } finally {
    chatModelsLoading.value = false;
  }
}

function onChatModelPanelOpenChange(isOpen: boolean) {
  if (!isOpen || chatModelsLoading.value) return;
  if (chatModelOptions.value.length > 0) return;
  void refreshChatModels();
}

function onListScroll() {
  const el = listRef.value;
  if (!el) return;
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
  showJumpBottom.value = dist > 100;
}

async function refreshBookHash() {
  bookHash.value = "";
  if (!props.sessionFilePath || !props.physicalReaderPath) return;
  try {
    const st = await window.colorTxt.stat(props.physicalReaderPath);
    if (!st.isFile) return;
    bookHash.value = await hashBookBrowser(
      props.sessionFilePath,
      st.size,
      st.mtimeMs,
    );
  } catch {
    bookHash.value = "";
  }
}

async function loadThreadList() {
  if (!bookHash.value) {
    threads.value = [];
    return;
  }
  const list = await window.colorTxt.ai.threadList(bookHash.value);
  threads.value = list.map((t) => ({
    id: t.id,
    title: t.title,
    updatedAt: t.updatedAt,
  }));
}

async function loadMessagesForThread(tid: string) {
  const rows = await window.colorTxt.ai.messageList(tid);
  messages.value = rows
    .filter((r) => r.role === "user" || r.role === "assistant")
    .map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant",
      content: r.content,
      aborted: r.aborted,
      createdAt: r.createdAt,
    }));
  await nextTick();
  scrollToBottom();
}

async function ensureThread() {
  if (!bookHash.value) return;
  await loadThreadList();
  if (threads.value.length === 0) {
    const id = await window.colorTxt.ai.threadCreate(bookHash.value, "新对话");
    threadId.value = id;
    await loadThreadList();
  } else if (
    !threadId.value ||
    !threads.value.some((t) => t.id === threadId.value)
  ) {
    threadId.value = threads.value[0]!.id;
  }
  if (threadId.value) await loadMessagesForThread(threadId.value);
}

watch(
  () => [props.sessionFilePath, props.physicalReaderPath] as const,
  () => {
    threadId.value = null;
    messages.value = [];
    void (async () => {
      await refreshBookHash();
      await syncChatModelFromConfig();
      void refreshChatModels();
      await ensureThread();
    })();
  },
  { immediate: true },
);

watch(hasFile, () => {
  void nextTick(() => autosizeComposerInput());
});

function scrollToBottom() {
  const el = listRef.value;
  if (el) el.scrollTop = el.scrollHeight;
  showJumpBottom.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onHistoryDocPointerDown);
  document.addEventListener("keydown", onHistoryDocKeydown, true);
  window.addEventListener("resize", onHistoryWindowResize);
  void nextTick(() => autosizeComposerInput());
  offChunk = window.colorTxt.ai.onChatChunk(({ requestId, delta }) => {
    if (requestId !== activeRequestId.value) return;
    const last = messages.value[messages.value.length - 1];
    if (!last || last.role !== "assistant") return;
    last.content += delta;
    void nextTick(() => scrollToBottom());
  });
  offDone = window.colorTxt.ai.onChatDone(({ requestId }) => {
    if (requestId !== activeRequestId.value) return;
    streaming.value = false;
    void persistAssistantIfNeeded(requestId, false);
  });
  offErr = window.colorTxt.ai.onChatError(({ requestId, message }) => {
    if (requestId !== activeRequestId.value) return;
    streaming.value = false;
    const last = messages.value[messages.value.length - 1];
    if (last?.role === "assistant") {
      last.content += `\n\n（错误：${message}）`;
    }
    void persistAssistantIfNeeded(requestId, false);
  });
});

async function persistAssistantIfNeeded(requestId: number, aborted: boolean) {
  if (persistedChatRequests.has(requestId)) return;
  persistedChatRequests.add(requestId);
  const tid = threadId.value;
  if (!tid) return;
  const last = messages.value[messages.value.length - 1];
  if (!last || last.role !== "assistant") return;
  const aid = await window.colorTxt.ai.messageAppend(
    tid,
    "assistant",
    last.content,
    aborted,
  );
  last.id = aid;
  last.createdAt = Date.now();
  if (
    messages.value.filter((m) => m.role === "user").length === 1 &&
    messages.value.filter((m) => m.role === "assistant").length === 1
  ) {
    const u = messages.value.find((m) => m.role === "user");
    if (u) {
      const title = u.content.trim().slice(0, 24) || "对话";
      await window.colorTxt.ai.threadRename(tid, title);
      await loadThreadList();
    }
  }
}

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onHistoryDocPointerDown);
  document.removeEventListener("keydown", onHistoryDocKeydown, true);
  window.removeEventListener("resize", onHistoryWindowResize);
  offChunk?.();
  offDone?.();
  offErr?.();
  if (streaming.value) {
    const rid = activeRequestId.value;
    window.colorTxt.ai.chatAbort(rid);
    void persistAssistantIfNeeded(rid, true);
  }
});

async function buildIndex(): Promise<boolean> {
  if (!bookHash.value || !props.readerMainRef?.getAllText) return false;
  indexError.value = "";
  const cfg = await window.colorTxt.ai.configGet();
  const full = props.readerMainRef.getAllText();
  indexPhase.value = "chunking";
  const drafts = chunkNovelForAi({
    fullText: full,
    chapters: props.chapters,
    bookHash: bookHash.value,
    targetTokens: cfg.chunkTargetTokens,
    minTokens: cfg.chunkMinTokens,
    overlapRatio: cfg.chunkOverlapRatio,
  });
  const texts = drafts.map((d) => d.content);
  indexPhase.value = "embedding";
  indexEmbedTotal.value = Math.max(1, Math.ceil(texts.length / 20));
  indexEmbedCurrent.value = 0;
  const allEmb: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += 20) {
      const batch = texts.slice(i, i + 20);
      const emb = await window.colorTxt.ai.embed(batch);
      allEmb.push(...emb);
      indexEmbedCurrent.value = Math.min(
        indexEmbedTotal.value,
        indexEmbedCurrent.value + 1,
      );
    }
    indexPhase.value = "indexing";
    const records = drafts.map((d, j) => ({
      ...d,
      embedding: allEmb[j]!,
    }));
    const r = await window.colorTxt.ai.indexReplaceChunks(
      bookHash.value,
      records,
    );
    if (!r.ok) {
      indexPhase.value = "error";
      indexError.value = r.error ?? "索引写入失败";
      return false;
    }
    indexPhase.value = "idle";
    return true;
  } catch (e) {
    indexPhase.value = "error";
    indexError.value = e instanceof Error ? e.message : String(e);
    return false;
  }
}

async function ensureIndexed(): Promise<boolean> {
  if (!bookHash.value) return false;
  const has = await window.colorTxt.ai.indexHasBook(bookHash.value);
  if (has) return true;
  return buildIndex();
}

function resolvedChapterIdxForAi(): number {
  if (props.activeChapterIdx >= 0) return props.activeChapterIdx;
  const probe = props.readerMainRef?.getProbeLine?.() ?? 1;
  return pickActiveChapterIdx(props.chapters, probe);
}

function bookMetaPayload() {
  const path = props.sessionFilePath ?? "";
  const base =
    path
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? "未命名";
  const idx = resolvedChapterIdxForAi();
  const ch = idx >= 0 ? props.chapters[idx] : undefined;
  return {
    fileTitle: base,
    chapterCount: Math.max(props.chapters.length, 1),
    currentChapterIndex: idx,
    currentChapterTitle:
      idx >= 0 ? (ch?.title ?? "") : "（阅读位置未匹配到章节）",
  };
}

async function onSend() {
  const text = input.value.trim();
  if (!text || streaming.value || !hasFile.value) return;
  await ensureThread();
  const tid = threadId.value;
  if (!tid || !bookHash.value) return;

  const cfg = await window.colorTxt.ai.configGet();
  const effectiveModel = activeChatModel.value.trim() || cfg.chat.model.trim();
  if (!effectiveModel) {
    alert("请先在设置 → AI 中配置对话模型，或在本面板选择模型。");
    return;
  }

  input.value = "";
  void nextTick(() => autosizeComposerInput());
  const uid = await window.colorTxt.ai.messageAppend(tid, "user", text);
  const userTs = Date.now();
  messages.value.push({
    id: uid,
    role: "user",
    content: text,
    createdAt: userTs,
  });
  await nextTick();
  scrollToBottom();

  messages.value.push({
    id: `pending_${userTs}`,
    role: "assistant",
    content: "",
    createdAt: userTs,
  });

  let ragSnippets: AIChatStreamPayload["ragSnippets"] = [];
  try {
    const ok = await ensureIndexed();
    if (ok) {
      const emb = await window.colorTxt.ai.embed([text]);
      const q = emb[0];
      if (q) {
        const hits = await window.colorTxt.ai.indexSearch({
          bookHash: bookHash.value,
          queryEmbedding: q,
          topK: cfg.ragTopK,
        });
        if (Array.isArray(hits)) {
          ragSnippets = (hits as AIIndexSearchHit[]).map((h) => ({
            chapterIndex: h.chapterIndex,
            chapterTitle: h.chapterTitle,
            content: h.content,
          }));
        }
      }
    }
  } catch {
    // 无索引或非致命：继续对话
  }

  const history = messages.value
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, -1)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  activeRequestId.value += 1;
  const requestId = activeRequestId.value;
  streaming.value = true;

  const bookMeta = bookMetaPayload();
  const currentChapterText = getCurrentChapterPlainText(
    props.readerMainRef ?? undefined,
    props.chapters,
    bookMeta.currentChapterIndex,
    80_000,
  );

  const override =
    activeChatModel.value.trim() &&
    activeChatModel.value.trim() !== savedConfigModel.value.trim()
      ? activeChatModel.value.trim()
      : undefined;

  const payload: AIChatStreamPayload = {
    requestId,
    messages: history,
    ragSnippets,
    bookMeta,
    currentChapterText:
      currentChapterText.trim() !== "" ? currentChapterText : undefined,
    deepThinking: deepThinking.value,
    spoilerSafe: spoilerSafe.value ? true : undefined,
    chatModelOverride: override,
  };

  const start = await window.colorTxt.ai.chatStart(payload);
  if (!start.ok) {
    streaming.value = false;
    const last = messages.value[messages.value.length - 1];
    if (last?.role === "assistant") {
      last.content = start.error ?? "无法发起对话";
    }
  }
}

function onStop() {
  const rid = activeRequestId.value;
  window.colorTxt.ai.chatAbort(rid);
  streaming.value = false;
  const last = messages.value[messages.value.length - 1];
  if (last?.role === "assistant" && !last.content.includes("用户已停止")) {
    last.content += "\n\n_(用户已停止)_";
    last.aborted = true;
  }
  void persistAssistantIfNeeded(rid, true);
}

async function onNewChat() {
  if (!bookHash.value) return;
  if (streaming.value) onStop();
  const id = await window.colorTxt.ai.threadCreate(bookHash.value, "新对话");
  threadId.value = id;
  messages.value = [];
  await loadThreadList();
  historyOpen.value = false;
}

async function positionHistoryDropdown() {
  const trig = historyBtnRef.value;
  if (!trig) return;
  const r = trig.getBoundingClientRect();
  historyDropWidth.value = Math.max(240, Math.min(340, r.width + 200));
  historyDropLeft.value = r.left;
  historyDropTop.value = r.bottom + 4;
  await nextTick();
  const panel = historyDropdownRef.value;
  if (!panel) return;
  const margin = 8;
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  const maxX = Math.max(margin, window.innerWidth - w - margin);
  const maxY = Math.max(margin, window.innerHeight - h - margin);
  historyDropLeft.value = Math.min(
    Math.max(margin, historyDropLeft.value),
    maxX,
  );
  historyDropTop.value = Math.min(Math.max(margin, historyDropTop.value), maxY);
}

async function toggleHistoryDropdown() {
  if (historyOpen.value) {
    historyOpen.value = false;
    return;
  }
  exportMenuOpen.value = false;
  await loadThreadList();
  historyOpen.value = true;
  await nextTick();
  await positionHistoryDropdown();
}

async function positionExportDropdown() {
  const trig = exportBtnRef.value;
  if (!trig) return;
  const r = trig.getBoundingClientRect();
  exportDropWidth.value = Math.max(220, Math.min(280, r.width + 160));
  exportDropLeft.value = r.right - exportDropWidth.value;
  exportDropTop.value = r.bottom + 4;
  await nextTick();
  const panel = exportDropdownRef.value;
  if (!panel) return;
  const margin = 8;
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  const maxX = Math.max(margin, window.innerWidth - w - margin);
  const maxY = Math.max(margin, window.innerHeight - h - margin);
  exportDropLeft.value = Math.min(Math.max(margin, exportDropLeft.value), maxX);
  exportDropTop.value = Math.min(Math.max(margin, exportDropTop.value), maxY);
}

async function toggleExportMenu() {
  if (messages.value.length === 0) return;
  exportMenuOpen.value = !exportMenuOpen.value;
  if (exportMenuOpen.value) {
    historyOpen.value = false;
    await nextTick();
    await positionExportDropdown();
  }
}

function chatExportDateSlug(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function exportThreadTitle(): string {
  const tid = threadId.value;
  const row = tid ? threads.value.find((x) => x.id === tid) : undefined;
  if (row?.title?.trim()) return row.title.trim();
  const firstUser = messages.value.find((m) => m.role === "user");
  const u = firstUser?.content.trim();
  if (u) return u.length > 120 ? `${u.slice(0, 120)}…` : u;
  return "对话";
}

function resolveExportSaveDefaultPath(fileName: string): string | undefined {
  const base = props.physicalReaderPath || props.sessionFilePath;
  if (!base?.trim()) return undefined;
  const dir = dirnameFs(base.trim());
  if (!dir || dir === ".") return undefined;
  return joinFs(dir, fileName);
}

/** ReadAny 风格 Markdown（复制与导出共用） */
function buildReadAnyMarkdown(): string {
  const title = exportThreadTitle();
  const lines: string[] = [`# ${title}`, ""];
  for (const m of messages.value) {
    const label = m.role === "user" ? "**你**" : "**AI**";
    lines.push(label, "", m.content, "", "---", "");
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  while (lines.length && lines[lines.length - 1] === "---") lines.pop();
  lines.push(
    "",
    "---",
    "",
    `*${title} — Exported ${new Date().toLocaleString()}*`,
  );
  return lines.join("\n");
}

function buildReadAnyJson(): string {
  const title = exportThreadTitle();
  const exportedAt = new Date().toISOString();
  const payload = {
    title,
    exportedAt,
    messages: messages.value.map((m) => ({
      id: m.id,
      role: m.role,
      parts: [{ type: "text", text: m.content }],
      createdAt: m.createdAt ?? Date.now(),
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

async function exportMd() {
  const tid = threadId.value;
  if (!tid || messages.value.length === 0) return;
  exportMenuOpen.value = false;
  const slug = chatExportDateSlug();
  const name = `chat-${slug}.md`;
  const r = await window.colorTxt.ai.exportSave({
    defaultName: name,
    defaultPath: resolveExportSaveDefaultPath(name),
    data: buildReadAnyMarkdown(),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!r.ok && "error" in r) alert(r.error);
}

async function exportJson() {
  const tid = threadId.value;
  if (!tid || messages.value.length === 0) return;
  exportMenuOpen.value = false;
  const slug = chatExportDateSlug();
  const name = `chat-${slug}.json`;
  const r = await window.colorTxt.ai.exportSave({
    defaultName: name,
    defaultPath: resolveExportSaveDefaultPath(name),
    data: buildReadAnyJson(),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!r.ok && "error" in r) alert(r.error);
}

async function copyAllMarkdown() {
  if (messages.value.length === 0) return;
  exportMenuOpen.value = false;
  try {
    await navigator.clipboard.writeText(buildReadAnyMarkdown());
  } catch {
    alert("复制失败：剪贴板不可用");
  }
}

function onHistoryDocPointerDown(ev: PointerEvent) {
  const t = ev.target as Node | null;
  if (historyOpen.value) {
    if (t && historyDropdownRef.value?.contains(t)) return;
    if (t && historyBtnRef.value?.contains(t)) return;
    historyOpen.value = false;
  }
  if (exportMenuOpen.value) {
    if (t && exportDropdownRef.value?.contains(t)) return;
    if (t && exportBtnRef.value?.contains(t)) return;
    exportMenuOpen.value = false;
  }
}

function onHistoryDocKeydown(ev: KeyboardEvent) {
  if (ev.key !== "Escape") return;
  if (historyOpen.value) {
    ev.preventDefault();
    historyOpen.value = false;
    return;
  }
  if (exportMenuOpen.value) {
    ev.preventDefault();
    exportMenuOpen.value = false;
  }
}

function onHistoryWindowResize() {
  if (historyOpen.value) void positionHistoryDropdown();
  if (exportMenuOpen.value) void positionExportDropdown();
}

async function selectThread(id: string) {
  if (streaming.value) onStop();
  threadId.value = id;
  await loadMessagesForThread(id);
  historyOpen.value = false;
}

function onHistoryRowKeydown(e: KeyboardEvent, id: string) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    void selectThread(id);
  }
}

async function deleteThread(id: string) {
  await window.colorTxt.ai.threadDelete(id);
  if (threadId.value === id) threadId.value = null;
  await ensureThread();
  if (historyOpen.value) {
    await nextTick();
    await positionHistoryDropdown();
  }
}

function onChClick(ch1: number) {
  const idx = ch1 - 1;
  const ch = props.chapters[idx];
  if (ch) emit("jumpToChapter", ch);
  else alert(`未找到第 ${ch1} 章`);
}

async function copyMsg(content: string, ev: Event) {
  try {
    await navigator.clipboard.writeText(content);
    const btn = (ev.currentTarget as HTMLElement).querySelector(".copyIcon");
    if (btn) {
      btn.innerHTML = icons.success;
      window.setTimeout(() => {
        btn.innerHTML = icons.copy;
      }, 900);
    }
  } catch {
    // ignore
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void onSend();
  }
}
</script>

<template>
  <div class="aiPanel">
    <div class="aiToolbarRow">
      <button
        ref="historyBtnRef"
        type="button"
        class="aiActivityLikeBtn"
        title="历史会话"
        aria-label="历史会话"
        aria-haspopup="listbox"
        :aria-expanded="historyOpen"
        @click="toggleHistoryDropdown"
      >
        <span class="svg" v-html="icons.history" />
      </button>
      <div class="aiModelPickWrap">
        <AppCustomSelect
          class="aiModelPick"
          :model-value="activeChatModel"
          :display-label="chatModelDisplayLabel"
          :fixed-top-items="selectListsEmpty"
          :scroll-items="chatModelScrollItems"
          :fixed-bottom-items="selectListsEmpty"
          :scroll-max-height="260"
          :min-panel-width="240"
          ariaLabel="对话模型"
          @panel-open-change="onChatModelPanelOpenChange"
          @update:model-value="activeChatModel = $event"
        />
      </div>
      <div class="aiToolbarEnd">
        <button
          ref="exportBtnRef"
          type="button"
          class="aiActivityLikeBtn"
          title="导出 / 复制"
          aria-label="导出"
          aria-haspopup="menu"
          :aria-expanded="exportMenuOpen"
          :disabled="messages.length === 0"
          @click="toggleExportMenu"
        >
          <span class="svg" v-html="icons.download" />
        </button>
        <button
          type="button"
          class="aiActivityLikeBtn"
          title="新对话"
          @click="onNewChat"
        >
          <span class="svg" v-html="icons.newChat" />
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="historyOpen"
        ref="historyDropdownRef"
        class="aiHistoryDropdown appShellMenuPanel"
        data-fullscreen-sidebar-float
        role="listbox"
        aria-label="会话历史"
        :style="{
          left: `${historyDropLeft}px`,
          top: `${historyDropTop}px`,
          width: `${historyDropWidth}px`,
        }"
        @click.stop
      >
        <ul
          v-if="threads.length > 0"
          class="aiHistoryDropdownList"
          role="presentation"
        >
          <li
            v-for="t in threads"
            :key="t.id"
            class="aiHistoryDropdownRow"
            :class="{ 'is-active': t.id === threadId }"
            role="option"
            tabindex="-1"
            :aria-selected="t.id === threadId"
            @click="selectThread(t.id)"
            @keydown="onHistoryRowKeydown($event, t.id)"
          >
            <span class="aiHistoryDropdownLabel">{{
              t.title || "未命名"
            }}</span>
            <button
              type="button"
              class="aiHistoryDropdownDelete"
              title="删除会话"
              aria-label="删除会话"
              tabindex="-1"
              @click.stop="deleteThread(t.id)"
            >
              <span class="svg" v-html="icons.remove" />
            </button>
          </li>
        </ul>
        <p v-else class="aiHistoryDropdownEmpty">暂无历史会话</p>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="exportMenuOpen"
        ref="exportDropdownRef"
        class="aiExportDropdown appShellMenuPanel"
        data-fullscreen-sidebar-float
        role="menu"
        aria-label="导出"
        :style="{
          left: `${exportDropLeft}px`,
          top: `${exportDropTop}px`,
          width: `${exportDropWidth}px`,
        }"
        @click.stop
      >
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="exportMd"
        >
          导出 Markdown
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="exportJson"
        >
          导出 JSON
        </button>
        <div class="appShellMenuDivider" role="presentation" />
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="copyAllMarkdown"
        >
          复制全部
        </button>
      </div>
    </Teleport>

    <div class="aiListWrap">
      <div ref="listRef" class="aiList" @scroll="onListScroll">
        <div v-if="!hasFile" class="aiHint">请先打开一本书后再开始聊天。</div>
        <template v-else>
          <div
            v-if="indexPhase !== 'idle' && indexPhase !== 'error'"
            class="aiIndexBanner"
          >
            <template v-if="indexPhase === 'chunking'">正在分块…</template>
            <template v-else-if="indexPhase === 'embedding'">
              正在向量化 {{ indexEmbedCurrent }} / {{ indexEmbedTotal }} …
            </template>
            <template v-else>正在写入索引…</template>
          </div>
          <div v-if="indexPhase === 'error'" class="aiIndexErr">
            索引失败：{{ indexError }}
          </div>

          <div
            v-if="messages.length === 0 && indexPhase === 'idle'"
            class="aiHint"
          >
            <div>分析内容、剧情、角色等。</div>
            <div>首次提问会为本书建立本地向量索引。</div>
          </div>

          <div
            v-for="m in messages"
            :key="m.id"
            class="aiMsg"
            :class="m.role === 'user' ? 'aiMsg--user' : 'aiMsg--bot'"
          >
            <div class="aiMsgInner">
              <AiMarkdown
                v-if="m.role === 'assistant'"
                :source="m.content"
                @chapter-click="onChClick"
              />
              <div v-else class="aiUserText">{{ m.content }}</div>
              <button
                v-if="m.content && m.role === 'assistant'"
                type="button"
                class="copyBtn"
                title="复制"
                @click="copyMsg(m.content, $event)"
              >
                <span class="svg copyIcon" v-html="icons.copy" />
              </button>
            </div>
          </div>
        </template>
      </div>
      <button
        v-show="showJumpBottom"
        type="button"
        class="aiJumpBottom btn"
        @click="scrollToBottom"
      >
        <span class="svg" v-html="icons.down" />
        回到底部
      </button>
    </div>

    <div class="aiComposer">
      <textarea
        ref="composerInputRef"
        v-model="input"
        class="aiComposerInput"
        rows="1"
        :disabled="!hasFile || streaming"
        placeholder="关于这本书的问题…"
        @input="autosizeComposerInput"
        @keydown="onKeydown"
      />
      <div class="aiComposerFooter">
        <div class="aiComposerToggles">
          <button
            type="button"
            class="aiPillToggle"
            :class="{ 'aiPillToggle--on': deepThinking }"
            title="深度思考：先列依据再结论"
            @click="deepThinking = !deepThinking"
          >
            <span class="svg aiPillToggle__icon" v-html="icons.brain" />
            深度思考
          </button>
          <button
            type="button"
            class="aiPillToggle"
            :class="{ 'aiPillToggle--on': spoilerSafe }"
            title="尽量不透露当前章之后的剧情"
            @click="spoilerSafe = !spoilerSafe"
          >
            <span class="svg aiPillToggle__icon" v-html="icons.viewOff" />
            防剧透
          </button>
        </div>
        <button
          v-if="streaming"
          type="button"
          class="aiActivityLikeBtn aiComposerActionBtn aiComposerStopBtn"
          title="停止生成"
          @click="onStop"
        >
          <span class="svg" v-html="icons.stop" />
        </button>
        <button
          v-else
          type="button"
          class="aiActivityLikeBtn aiComposerActionBtn aiComposerSendBtn"
          title="发送"
          :disabled="!hasFile || !input.trim()"
          @click="onSend"
        >
          <span class="svg" v-html="icons.send" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aiPanel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}

.aiToolbarRow {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.aiModelPickWrap {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  justify-content: flex-end;
}

.aiModelPick {
  /* max-width: 150px; */
  min-width: 0;
  flex: unset;
}

.aiToolbarEnd {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

/**
 * 与左侧活动栏图标按钮同系（透明底、tab 字色），
 * 尺寸与当前行模型下拉触发器高度对齐。
 */
.aiActivityLikeBtn {
  box-sizing: border-box;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: var(--tab-fg);
}

.aiActivityLikeBtn:hover:not(:disabled) {
  color: var(--tab-fg-hover);
  background: var(--icon-btn-bg-hover);
}

.aiActivityLikeBtn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.aiActivityLikeBtn .svg :deep(svg) {
  width: 16px;
  height: 16px;
}

.aiActivityLikeBtn .svg :deep(svg path) {
  fill: currentColor;
}

.svg :deep(svg) {
  width: 18px;
  height: 18px;
  display: block;
}

.aiListWrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.aiList {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 12px 12px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  user-select: text;
  -webkit-user-select: text;
  cursor: auto;
}

.aiJumpBottom {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 999px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
  white-space: nowrap;
}

.aiJumpBottom .svg :deep(svg) {
  width: 14px;
  height: 14px;
}

.aiJumpBottom .svg :deep(svg path) {
  fill: currentColor;
}

.aiHint {
  font-size: 13px;
  color: var(--secondary);
  line-height: 1.5;
  padding: 12px 8px;
  user-select: none;
}

.aiIndexBanner,
.aiIndexErr {
  font-size: 12px;
  padding: 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--fg);
}

.aiIndexErr {
  background: color-mix(in srgb, #f44 15%, transparent);
}

.aiMsg {
  display: flex;
}

.aiMsg--user {
  justify-content: flex-end;
}

.aiMsgInner {
  max-width: 92%;
  position: relative;
  padding: 8px 10px;
  border-radius: 10px;
}

.aiMsg--user .aiMsgInner {
  background: var(--icon-btn-bg-active);
}

.aiUserText {
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
}

.copyBtn {
  position: absolute;
  top: 4px;
  right: 4px;
  opacity: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 4px;
}

.aiMsgInner:hover .copyBtn {
  opacity: 1;
}

.aiComposer {
  flex-shrink: 0;
  margin: 10px 10px 12px;
  padding: 10px 10px 8px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.12s ease;
}

.aiComposer:focus-within {
  border-color: var(--accent);
}

.aiComposerInput {
  width: 100%;
  box-sizing: border-box;
  min-height: calc(1.45em + 8px);
  max-height: 168px;
  overflow-x: hidden;
  overflow-y: hidden;
  resize: none;
  padding: 6px 4px 4px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--fg);
  font-size: 13px;
  line-height: 1.45;
  font-family: inherit;
  user-select: text;
  -webkit-user-select: text;
  /** 预留纵向滚动条槽位，避免出现滚动条时变窄换行、行数突变 */
  scrollbar-gutter: stable;
}

.aiComposerInput:focus {
  outline: none;
}

.aiComposerFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.aiComposerToggles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.aiPillToggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  line-height: 1.2;
}

.aiPillToggle:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.aiPillToggle--on {
  color: var(--fg);
  background: var(--icon-btn-bg-active);
}

.aiPillToggle__icon :deep(svg) {
  width: 15px;
  height: 15px;
}

.aiPillToggle__icon :deep(svg path) {
  fill: currentColor;
}

.aiComposerSendBtn:not(:disabled) {
  color: var(--fgj);
}

.aiActivityLikeBtn.aiComposerSendBtn:hover:not(:disabled) {
  color: var(--fgj);
}

.aiComposerStopBtn {
  color: var(--danger);
}

.aiActivityLikeBtn.aiComposerStopBtn:hover:not(:disabled) {
  color: var(--danger);
}

.aiComposerActionBtn .svg :deep(svg path) {
  fill: currentColor;
}

.aiHistoryDropdown {
  position: fixed;
  z-index: 7200;
  box-sizing: border-box;
  max-height: min(360px, calc(100vh - 24px));
  display: flex;
  flex-direction: column;
  min-width: 0;
  /** 与 FontPicker `.fontMenu` 一致 */
  padding: 6px;
}

.aiExportDropdown {
  position: fixed;
  z-index: 7200;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.aiHistoryDropdownList {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.aiHistoryDropdownRow {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  height: 36px;
  padding: 0 4px 0 10px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--list-item-fg);
  font-size: 12px;
  line-height: 1.2;
  outline: none;
}

.aiHistoryDropdownRow:hover {
  background: var(--list-item-bg-hover);
}

.aiHistoryDropdownRow.is-active {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.aiHistoryDropdownRow.is-active:hover {
  background: color-mix(in srgb, var(--accent) 14%, var(--list-item-bg-hover));
}

.aiHistoryDropdownLabel {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiHistoryDropdownDelete {
  flex-shrink: 0;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.12s ease,
    color 0.12s ease;
}

.aiHistoryDropdownRow:hover .aiHistoryDropdownDelete,
.aiHistoryDropdownRow:focus-within .aiHistoryDropdownDelete {
  opacity: 1;
}

.aiHistoryDropdownDelete:hover {
  color: var(--danger);
}

.aiHistoryDropdownDelete .svg :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.aiHistoryDropdownDelete .svg :deep(svg path) {
  fill: currentColor;
}

.aiHistoryDropdownEmpty {
  margin: 0;
  padding: 10px;
  font-size: 12px;
  color: var(--muted);
  text-align: center;
}
</style>
