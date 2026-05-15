import { computed, nextTick, ref, watch, type Ref } from "vue";
import type ReaderMain from "../components/ReaderMain.vue";
import {
  clampVoiceReadPitch,
  clampVoiceReadRate,
  mergeVoiceReadSettings,
  type VoiceReadEngineId,
  type VoiceReadSettings,
} from "../constants/voiceRead";
import { VoiceReadLinePlayer } from "../services/voiceRead/voiceReadLinePlayer";
import {
  splitVoiceReadChunks,
  VOICE_READ_CHUNK_UNITS_DEFAULT,
  VOICE_READ_CHUNK_UNITS_EDGE,
} from "../services/voiceRead/voiceReadTextChunks";

export type VoiceReadMode = "off" | "playing" | "paused";

/** 多行一次会话，Edge 在同一条时间线上跨行缓冲 fetch */
const VOICE_READ_BATCH_LINES = 28;

function chunkUnitsForEngine(engine: VoiceReadEngineId): number {
  if (engine === "edge") return VOICE_READ_CHUNK_UNITS_EDGE;
  return VOICE_READ_CHUNK_UNITS_DEFAULT;
}

export function useAppVoiceRead(deps: {
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  voiceReadSettings: Ref<VoiceReadSettings>;
  currentFile: Ref<string | null>;
  loading: Ref<boolean>;
  readerEditMode: Ref<boolean>;
  monacoSmoothScrolling: Ref<boolean>;
}) {
  const mode = ref<VoiceReadMode>("off");
  const isSynthesizing = ref(false);
  const toolbarRate = ref(1);
  const toolbarPitch = ref(1);
  const player = new VoiceReadLinePlayer();
  player.onSynthesizingChange = (active) => {
    isSynthesizing.value = active;
  };
  let currentLine = 1;
  /** 当前批次内正在播的段索引 */
  let currentChunkIndex = 0;
  const resumeWaiters: Array<() => void> = [];
  let playbackLoopGen = 0;

  function isPlaybackAlive(gen: number, modeValue: VoiceReadMode): boolean {
    return gen === playbackLoopGen && modeValue !== "off";
  }

  /** 当前批次（供行内 jumpToChunk） */
  let activeBatchEnd = 0;
  let activeChunks: string[] = [];
  let activeChunkToLine: number[] = [];

  watch(mode, (m) => {
    if (m === "playing") {
      deps.readerRef.value?.closeFindWidgetIfRevealed?.();
      const w = resumeWaiters.splice(0, resumeWaiters.length);
      for (const fn of w) fn();
    }
  });

  async function waitIfPaused(): Promise<void> {
    while (mode.value === "paused") {
      await new Promise<void>((resolve) => {
        resumeWaiters.push(resolve);
      });
    }
  }

  const isVoiceReadActive = computed(() => mode.value !== "off");
  const isVoiceReadScrollLocked = computed(() => mode.value === "playing");
  const isVoiceReadBlocksFind = computed(() => mode.value === "playing");
  /** 朗读模式中（含暂停）：顶栏排版/编辑相关控件不可用 */
  const isVoiceReadHeaderLocked = computed(() => mode.value !== "off");

  function effectiveSettingsForSpeak(): VoiceReadSettings {
    const base = deps.voiceReadSettings.value;
    return mergeVoiceReadSettings({
      ...base,
      rate: clampVoiceReadRate(toolbarRate.value),
      pitch: clampVoiceReadPitch(toolbarPitch.value),
    });
  }

  function clearActiveBatch() {
    activeBatchEnd = 0;
    activeChunks = [];
    activeChunkToLine = [];
    currentChunkIndex = 0;
  }

  function exitVoiceRead() {
    playbackLoopGen += 1;
    player.onChunkChange = undefined;
    isSynthesizing.value = false;
    player.stop();
    clearActiveBatch();
    mode.value = "off";
    deps.readerRef.value?.setVoiceReadLineHighlight?.(null);
  }

  function syncToolbarFromPersisted() {
    const s = deps.voiceReadSettings.value;
    toolbarRate.value = s.rate;
    toolbarPitch.value = s.pitch;
  }

  function applyPlaybackLineHighlight(ln: number) {
    const reader = deps.readerRef.value;
    if (!reader) return;
    currentLine = ln;
    reader.setVoiceReadLineHighlight?.(ln);
    reader.scrollModelLineBlockToViewportCenter?.(
      ln,
      deps.monacoSmoothScrolling.value,
    );
  }

  /** 将锚点同步到批次内某段（段 → 模型行） */
  function syncPlaybackChunkAnchor(
    chunkIndex: number,
    chunkToModelLine: number[],
    fallbackLine: number,
  ) {
    if (chunkToModelLine.length === 0) return;
    const idx = Math.max(0, Math.min(chunkIndex, chunkToModelLine.length - 1));
    currentChunkIndex = idx;
    applyPlaybackLineHighlight(chunkToModelLine[idx] ?? fallbackLine);
  }

  function bindChunkHighlight(
    gen: number,
    chunkToModelLine: number[],
    fallbackLine: number,
    baseChunkIndex = 0,
  ) {
    player.onChunkChange = (relIdx) => {
      if (!isPlaybackAlive(gen, mode.value)) return;
      const absIdx = baseChunkIndex + relIdx;
      if (absIdx < 0 || absIdx >= chunkToModelLine.length) return;
      currentChunkIndex = absIdx;
      const hl = chunkToModelLine[absIdx] ?? fallbackLine;
      if (hl === currentLine) return;
      applyPlaybackLineHighlight(hl);
      warmAdjacentSpeakableLines(hl);
    };
  }

  function scrollAndHighlightLine(ln: number) {
    applyPlaybackLineHighlight(ln);
  }

  function prefetchLineAfterBatch(
    batchEnd: number,
    settings: VoiceReadSettings,
  ) {
    const reader = deps.readerRef.value;
    const mCount = reader?.getModelLineCount?.() ?? 0;
    if (!reader || batchEnd >= mCount) return;
    const rawAfter = reader.getEditorLineContent?.(batchEnd + 1) ?? "";
    const textAfter = rawAfter.trim() ? rawAfter : " ";
    player.startPrefetch(settings, textAfter);
  }

  function warmLineText(line: number, settings: VoiceReadSettings) {
    const reader = deps.readerRef.value;
    if (!reader || line < 1) return;
    const raw = reader.getEditorLineContent?.(line) ?? "";
    if (!raw.trim()) return;
    player.warmLine(settings, raw);
  }

  /** 预生成锚点行上下各一行，手动上一行/下一行命中缓存 */
  function warmAdjacentSpeakableLines(anchorLine: number) {
    const settings = effectiveSettingsForSpeak();
    const prev = findAdjacentSpeakableLine(anchorLine, -1);
    const next = findAdjacentSpeakableLine(anchorLine, 1);
    const mCount = deps.readerRef.value?.getModelLineCount?.() ?? 0;
    if (prev !== anchorLine) warmLineText(prev, settings);
    if (next !== anchorLine && next <= mCount) warmLineText(next, settings);
  }

  async function runPlaybackLoop(startLine: number) {
    const gen = ++playbackLoopGen;
    currentLine = startLine;
    while (mode.value !== "off" && gen === playbackLoopGen) {
      await waitIfPaused();
      if (!isPlaybackAlive(gen, mode.value)) break;

      const reader = deps.readerRef.value;
      const mCount = reader?.getModelLineCount?.() ?? 0;
      if (!reader || mCount < 1) {
        exitVoiceRead();
        break;
      }
      const ln = Math.max(1, Math.min(currentLine, mCount));
      currentLine = ln;
      scrollAndHighlightLine(ln);

      const batchEnd = Math.min(mCount, ln + VOICE_READ_BATCH_LINES - 1);
      const settings = effectiveSettingsForSpeak();
      const units = chunkUnitsForEngine(settings.engine);
      const chunks: string[] = [];
      const chunkToModelLine: number[] = [];
      for (let L = ln; L <= batchEnd; L++) {
        const rawL = reader.getEditorLineContent?.(L) ?? "";
        const t = rawL.replace(/\s+/g, " ").trim();
        if (!t) continue;
        const parts = splitVoiceReadChunks(t, units);
        const useParts = parts.length > 0 ? parts : [t];
        for (const p of useParts) {
          chunks.push(p);
          chunkToModelLine.push(L);
        }
      }

      activeBatchEnd = batchEnd;
      activeChunks = chunks;
      activeChunkToLine = chunkToModelLine;

      if (chunks.length === 0) {
        if (batchEnd >= mCount) {
          player.discardPrefetch();
          exitVoiceRead();
          break;
        }
        currentLine = batchEnd + 1;
        continue;
      }

      prefetchLineAfterBatch(batchEnd, settings);
      syncPlaybackChunkAnchor(0, chunkToModelLine, ln);
      warmAdjacentSpeakableLines(ln);
      bindChunkHighlight(gen, chunkToModelLine, ln, 0);

      try {
        await player.speakChunks(settings, chunks);
      } catch {
        // 错误提示由 App 层处理
      }

      if (!isPlaybackAlive(gen, mode.value)) break;
      await waitIfPaused();
      if (!isPlaybackAlive(gen, mode.value)) break;

      if (batchEnd >= mCount) {
        player.discardPrefetch();
        exitVoiceRead();
        break;
      }

      currentLine = batchEnd + 1;
    }
  }

  function startFromViewportCenter() {
    const reader = deps.readerRef.value;
    if (!reader) return;
    const ln = reader.getModelLineAtViewportCenter?.() ?? 1;
    syncToolbarFromPersisted();
    mode.value = "playing";
    void runPlaybackLoop(ln);
  }

  function restartFromViewportTopAfterNavigation() {
    if (mode.value !== "playing") return;
    playbackLoopGen += 1;
    player.onChunkChange = undefined;
    player.stopForLineJump();
    void nextTick(() => {
      const reader = deps.readerRef.value;
      if (!reader || mode.value !== "playing") return;
      const top = reader.getViewportStartModelLine?.() ?? 1;
      void runPlaybackLoop(top);
    });
  }

  function getPlaybackAnchorLine(): number {
    const reader = deps.readerRef.value;
    const mCount = reader?.getModelLineCount?.() ?? 0;
    if (!reader || mCount < 1) return 1;

    if (
      activeChunkToLine.length > 0 &&
      currentChunkIndex >= 0 &&
      currentChunkIndex < activeChunkToLine.length
    ) {
      return Math.max(
        1,
        Math.min(activeChunkToLine[currentChunkIndex] ?? currentLine, mCount),
      );
    }

    const highlighted = reader.getVoiceReadHighlightedLine?.();
    if (highlighted != null && highlighted >= 1) {
      return Math.max(1, Math.min(highlighted, mCount));
    }

    return Math.max(1, Math.min(currentLine, mCount));
  }

  function firstChunkIndexForLine(line: number): number {
    return activeChunkToLine.findIndex((l) => l === line);
  }

  function lineHasSpeakableContent(line: number): boolean {
    const reader = deps.readerRef.value;
    if (!reader || line < 1) return false;
    const t = (reader.getEditorLineContent?.(line) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return t.length > 0;
  }

  function findAdjacentSpeakableLine(line: number, delta: -1 | 1): number {
    const mCount = deps.readerRef.value?.getModelLineCount?.() ?? 0;
    if (mCount < 1) return 1;
    let L = line + delta;
    while (L >= 1 && L <= mCount) {
      if (lineHasSpeakableContent(L)) return L;
      L += delta;
    }
    return Math.max(1, Math.min(L - delta, mCount));
  }

  /**
   * 批次内从指定段重播。
   * 与自动连播不同：会 stop 当前 AudioContext 再开新段，但不再用「行号±1」推算段下标。
   */
  function navigateToChunkIndex(targetChunkIndex: number) {
    if (mode.value === "off") return;
    mode.value = "playing";

    const reader = deps.readerRef.value;
    const mCount = reader?.getModelLineCount?.() ?? 0;
    if (!reader || mCount < 1) return;

    if (
      targetChunkIndex < 0 ||
      targetChunkIndex >= activeChunks.length ||
      activeChunks.length === 0
    ) {
      restartPlaybackFromLine(
        activeChunkToLine[Math.max(0, currentChunkIndex)] ?? currentLine,
      );
      return;
    }

    const ln = activeChunkToLine[targetChunkIndex] ?? currentLine;
    const batchEnd = activeBatchEnd;
    const chunks = activeChunks;
    const chunkToLine = activeChunkToLine;
    const settings = effectiveSettingsForSpeak();

    playbackLoopGen += 1;
    const gen = playbackLoopGen;

    player.onChunkChange = undefined;
    player.stopForLineJump();

    syncPlaybackChunkAnchor(targetChunkIndex, chunkToLine, ln);
    warmAdjacentSpeakableLines(ln);
    bindChunkHighlight(gen, chunkToLine, ln, targetChunkIndex);
    prefetchLineAfterBatch(batchEnd, settings);

    void player
      .jumpToChunk(settings, chunks, targetChunkIndex)
      .then(async () => {
        if (!isPlaybackAlive(gen, mode.value)) return;
        await waitIfPaused();
        if (!isPlaybackAlive(gen, mode.value)) return;
        if (batchEnd >= mCount) {
          player.discardPrefetch();
          exitVoiceRead();
          return;
        }
        currentLine = batchEnd + 1;
        void runPlaybackLoop(batchEnd + 1);
      });
  }

  /** 从指定行重新播（新批次）；用于跨批或空行 */
  function restartPlaybackFromLine(line: number) {
    if (mode.value === "off") return;
    const reader = deps.readerRef.value;
    const mCount = reader?.getModelLineCount?.() ?? 0;
    if (!reader || mCount < 1) return;
    const ln = Math.max(1, Math.min(Math.floor(line), mCount));

    playbackLoopGen += 1;
    player.onChunkChange = undefined;
    player.stopForLineJump();
    clearActiveBatch();
    scrollAndHighlightLine(ln);
    mode.value = "playing";
    void runPlaybackLoop(ln);
  }

  function playPrevLine() {
    if (mode.value === "off") return;

    if (activeChunkToLine.length > 0) {
      const anchorLine =
        activeChunkToLine[currentChunkIndex] ?? getPlaybackAnchorLine();
      for (let i = currentChunkIndex - 1; i >= 0; i--) {
        const line = activeChunkToLine[i]!;
        if (line < anchorLine) {
          navigateToChunkIndex(firstChunkIndexForLine(line));
          return;
        }
      }
    }

    const ln = getPlaybackAnchorLine();
    if (ln <= 1) return;
    restartPlaybackFromLine(findAdjacentSpeakableLine(ln, -1));
  }

  function playNextLine() {
    if (mode.value === "off") return;
    const mCount = deps.readerRef.value?.getModelLineCount?.() ?? 0;

    if (activeChunkToLine.length > 0) {
      const anchorLine =
        activeChunkToLine[currentChunkIndex] ?? getPlaybackAnchorLine();
      for (let i = currentChunkIndex + 1; i < activeChunkToLine.length; i++) {
        const line = activeChunkToLine[i]!;
        if (line > anchorLine) {
          navigateToChunkIndex(i);
          return;
        }
      }
    }

    const ln = getPlaybackAnchorLine();
    if (ln >= mCount) return;
    restartPlaybackFromLine(findAdjacentSpeakableLine(ln, 1));
  }

  function regenerateCurrentLine() {
    if (mode.value === "off") return;
    const reader = deps.readerRef.value;
    if (!reader) return;
    const ln = getPlaybackAnchorLine();
    const settings = effectiveSettingsForSpeak();
    const raw = reader.getEditorLineContent?.(ln) ?? "";
    player.invalidateLineSynthesis(settings, raw);
    if (mode.value === "paused") mode.value = "playing";
    restartPlaybackFromLine(ln);
  }

  const canPlayPrevLine = computed(() => {
    if (mode.value === "off") return false;
    return getPlaybackAnchorLine() > 1;
  });

  const canPlayNextLine = computed(() => {
    if (mode.value === "off") return false;
    const mCount = deps.readerRef.value?.getModelLineCount?.() ?? 0;
    return getPlaybackAnchorLine() < mCount;
  });

  function toggleVoiceReadToolbar() {
    if (mode.value === "off") {
      if (!canStartVoiceRead.value) return;
      startFromViewportCenter();
    } else {
      exitVoiceRead();
    }
  }

  /** 暂停后恢复：从视口中心行开播；有缓存则即时播放，无缓存则先合成 */
  function resumeFromPause() {
    if (mode.value !== "playing") return;
    const reader = deps.readerRef.value;
    const mCount = reader?.getModelLineCount?.() ?? 0;
    if (!reader || mCount < 1) return;

    let ln = Math.max(
      1,
      Math.min(reader.getModelLineAtViewportCenter?.() ?? 1, mCount),
    );
    if (!lineHasSpeakableContent(ln)) {
      const next = findAdjacentSpeakableLine(ln, 1);
      if (lineHasSpeakableContent(next)) ln = next;
      else {
        const prev = findAdjacentSpeakableLine(ln, -1);
        if (lineHasSpeakableContent(prev)) ln = prev;
      }
    }

    restartPlaybackFromLine(ln);
  }

  function togglePlayPause() {
    if (mode.value === "off") return;
    if (mode.value === "playing") {
      playbackLoopGen += 1;
      player.onChunkChange = undefined;
      isSynthesizing.value = false;
      player.pausePlayback();
      mode.value = "paused";
      return;
    }
    mode.value = "playing";
    isSynthesizing.value = false;
    void nextTick(() => {
      if (mode.value !== "playing") return;
      resumeFromPause();
    });
  }

  const canStartVoiceRead = computed(() => {
    if (!deps.currentFile.value?.trim()) return false;
    if (deps.loading.value) return false;
    if (deps.readerEditMode.value) return false;
    const n = deps.readerRef.value?.getModelLineCount?.() ?? 0;
    return n > 0;
  });

  watch(deps.currentFile, () => {
    player.clearSynthesisCache();
    exitVoiceRead();
  });

  watch(
    () => deps.voiceReadSettings.value,
    () => {
      player.clearSynthesisCache();
    },
    { deep: true },
  );

  watch(deps.readerEditMode, (ed) => {
    if (ed) exitVoiceRead();
  });

  watch(
    () => deps.loading.value,
    (ld) => {
      if (ld) exitVoiceRead();
    },
  );

  return {
    mode,
    isSynthesizing,
    toolbarRate,
    toolbarPitch,
    canStartVoiceRead,
    isVoiceReadActive,
    isVoiceReadScrollLocked,
    isVoiceReadBlocksFind,
    isVoiceReadHeaderLocked,
    toggleVoiceReadToolbar,
    togglePlayPause,
    restartFromViewportTopAfterNavigation,
    exitVoiceRead,
    playPrevLine,
    playNextLine,
    regenerateCurrentLine,
    canPlayPrevLine,
    canPlayNextLine,
    effectiveSettingsForSpeak,
  };
}
