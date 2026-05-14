<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { CharacterRosterEntry } from "@shared/characterTypes";
import zoomInSvg from "../assets/zoom_in.svg?raw";
import { icons } from "../icons";
import IconButton from "./IconButton.vue";

withDefaults(
  defineProps<{
    entry: CharacterRosterEntry;
    portraitUrl: string | null;
    flipped: boolean;
    /** 由列表父级统一测量，全卡同值 */
    nameZoom?: number;
  }>(),
  { nameZoom: 1 },
);

const emit = defineEmits<{
  toggleFlip: [];
  edit: [];
  viewPortrait: [];
}>();

const backScrollEl = ref<HTMLElement | null>(null);

function backScrollWheelDeltaY(ev: WheelEvent): number {
  switch (ev.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return ev.deltaY * 16;
    case WheelEvent.DOM_DELTA_PAGE:
      return ev.deltaY * (backScrollEl.value?.clientHeight ?? 80);
    default:
      return ev.deltaY;
  }
}

function onBackScrollWheel(ev: WheelEvent) {
  const el = backScrollEl.value;
  if (!el || !el.contains(ev.target as Node)) return;
  const maxScroll = el.scrollHeight - el.clientHeight;
  if (maxScroll <= 0) return;
  const dy = backScrollWheelDeltaY(ev);
  const next = Math.min(maxScroll, Math.max(0, el.scrollTop + dy));
  if (
    next === el.scrollTop &&
    (dy > 0 ? el.scrollTop >= maxScroll - 0.5 : el.scrollTop <= 0)
  ) {
    return;
  }
  el.scrollTop = next;
  ev.preventDefault();
  ev.stopPropagation();
}

const backScrollWheelOpts = { capture: true, passive: false } as const;

onMounted(() => {
  void nextTick(() => {
    const el = backScrollEl.value;
    if (!el) return;
    el.addEventListener("wheel", onBackScrollWheel, backScrollWheelOpts);
  });
});

onBeforeUnmount(() => {
  const el = backScrollEl.value;
  if (!el) return;
  el.removeEventListener("wheel", onBackScrollWheel, backScrollWheelOpts);
});
</script>

<template>
  <div class="cardShell" :class="{ flipped }">
    <div class="cardInner" @click="emit('toggleFlip')">
      <div class="cardFace cardFront">
        <div
          class="portrait"
          :style="portraitUrl ? { backgroundImage: `url(${portraitUrl})` } : {}"
        />
        <span
          class="cardNameVertical"
          :class="{
            'cardNameVertical--female': entry.gender === 'female',
            'cardNameVertical--male': entry.gender === 'male',
            'cardNameVertical--unknown': entry.gender === 'unknown',
          }"
          :style="{ zoom: nameZoom }"
          :title="entry.displayName || '佚名'"
        >
          {{ entry.displayName || "佚名" }}
        </span>
        <div class="cardCornerActions" @click.stop>
          <IconButton
            :icon-html="icons.edit"
            title="编辑"
            :aria-label="`编辑 ${entry.displayName}`"
            class="cardCornerAction"
            @click="emit('edit')"
          />
          <IconButton
            :icon-html="zoomInSvg"
            title="查看大图"
            aria-label="查看立绘大图"
            :disabled="!portraitUrl"
            class="cardCornerAction"
            @click="emit('viewPortrait')"
          />
        </div>
      </div>
      <div
        class="cardFace cardBack"
        :style="
          portraitUrl
            ? { '--card-portrait-bg': `url(${portraitUrl})` }
            : { '--card-portrait-bg': 'none' }
        "
      >
        <div
          class="cardNameBack"
          :class="{
            'cardNameBack--female': entry.gender === 'female',
            'cardNameBack--male': entry.gender === 'male',
            'cardNameBack--unknown': entry.gender === 'unknown',
          }"
          :title="entry.displayName || '佚名'"
        >
          {{ entry.displayName || "佚名" }}
        </div>
        <div ref="backScrollEl" class="backScroll">
          <div v-if="entry.ageText" class="backLine">
            <div class="k">年龄</div>
            <div class="v">{{ entry.ageText }}</div>
          </div>
          <div v-if="entry.identity" class="backLine">
            <div class="k">身份</div>
            <div class="v">{{ entry.identity }}</div>
          </div>
          <div v-if="entry.bio" class="backLine">
            <div class="k">简介</div>
            <div class="v">{{ entry.bio }}</div>
          </div>
          <div v-if="entry.relations" class="backLine">
            <div class="k">关系</div>
            <div class="v">{{ entry.relations }}</div>
          </div>
          <div
            v-if="
              !entry.ageText &&
              !entry.identity &&
              !entry.bio &&
              !entry.relations
            "
            class="charCardBackEmpty"
          >
            背面信息可在编辑中填写，或由检索自动摘录。
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cardShell {
  perspective: 900px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  aspect-ratio: 2 / 3;
}

.cardInner {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  transition: transform 0.38s ease;
  cursor: pointer;
}

.cardShell.flipped .cardInner {
  transform: rotateY(180deg);
}

.cardFace {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--panel-elevated, rgba(127, 127, 127, 0.06));
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.cardFront {
  z-index: 1;
}

.cardBack {
  transform: rotateY(180deg);
  font-size: 12px;
  line-height: 1.35;
  background: var(--bg);
  color: var(--fg);
  min-height: 0;
}

.cardBack::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  background-image: var(--card-portrait-bg, none);
  background-size: cover;
  background-position: center top;
  background-repeat: no-repeat;
  opacity: 0.15;
  pointer-events: none;
  /* filter: grayscale(1); */
}

.portrait {
  flex: 1 1 auto;
  min-height: 0;
  background: var(--panel);
  background-size: cover;
  background-position: center top;
}

.cardNameVertical {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
  box-sizing: border-box;
  max-height: calc(100% - 48px);
  padding: 12px 6px;
  color: #ffffff;
  font-family: "KingHwa OldSong", "Songti SC", "SimSun", serif;
  /* font-weight: 600; */
  font-size: 12px;
  line-height: 1.2;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  letter-spacing: 0.22em;
  overflow: hidden;
  pointer-events: none;
  border-bottom-left-radius: 8px;
}

.cardNameVertical--female {
  background: var(--female);
}

.cardNameVertical--male {
  background: var(--male);
}

.cardNameVertical--unknown {
  background: var(--unknown);
}

.cardCornerActions {
  position: absolute;
  bottom: 6px;
  left: 6px;
  z-index: 3;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;
}

.cardShell:not(.flipped):hover .cardCornerActions {
  opacity: 1;
  pointer-events: auto;
}

.iconBtn.cardCornerAction {
  width: 24px;
  height: 24px;
  background: rgba(0, 0, 0, 0.3);
}
.iconBtn.cardCornerAction:hover {
  background: rgba(0, 0, 0, 0.7);
}

:deep(.iconBtn.cardCornerAction .icon) {
  color: #ffffff;
}

.backScroll {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 4px;
}

.cardNameBack {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 8px;
  color: #ffffff;
  font-family: "KingHwa OldSong", "Songti SC", "SimSun", serif;
  /* font-weight: 600; */
  font-size: 16px;
  line-height: 1.2;
  letter-spacing: 0.22em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.cardNameBack--female {
  background: var(--female);
}

.cardNameBack--male {
  background: var(--male);
}

.cardNameBack--unknown {
  background: var(--unknown);
}

.backLine {
  padding: 4px;
  margin: 0;
}

.backLine + .backLine {
  margin-top: 4px;
}

.backLine .k {
  color: #ffffff;
  font-weight: 600;
  /* font-family: "KingHwa OldSong", "Songti SC", "SimSun", serif; */
  margin-bottom: 4px;
  padding: 4px 6px;
  border-radius: 4px;
  background: linear-gradient(to right, var(--warning), transparent);
}
.backLine .v {
  padding-left: 6px;
}

.charCardBackEmpty {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
</style>
