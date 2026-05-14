<script setup lang="ts">
import { useAiFoldContentSelectAll } from "../composables/useAiFoldContentSelectAll";
import { icons } from "../icons";

useAiFoldContentSelectAll();

const open = defineModel<boolean>("open", { required: true });

withDefaults(
  defineProps<{
    variant: "think" | "tool";
    /** 思考流未封存时高亮边框 */
    live?: boolean;
    /** 为 false 时不渲染正文容器（与原先「无摘录不显示内容区」一致） */
    showContent?: boolean;
  }>(),
  {
    live: false,
    showContent: true,
  },
);

const emit = defineEmits<{
  contentPointerdown: [ev: PointerEvent];
}>();

function onToggle(ev: Event) {
  open.value = (ev.target as HTMLDetailsElement).open;
}

function onContentPointerDown(ev: PointerEvent) {
  const t = ev.currentTarget;
  if (t instanceof HTMLElement) t.focus({ preventScroll: true });
  emit("contentPointerdown", ev);
}
</script>

<template>
  <details
    class="aiFold"
    :class="{
      'aiFold--liveThink': variant === 'think' && live,
      'aiFold--tool': variant === 'tool',
    }"
    :open="open"
    @toggle="onToggle"
  >
    <summary class="aiFoldSummary">
      <span
        class="aiFoldSummaryLead"
        :class="{ 'aiFoldSummaryLead--tool': variant === 'tool' }"
      >
        <span class="aiFoldLeadIcon" aria-hidden="true">
          <slot name="icon" />
        </span>
        <span class="aiFoldTitle">
          <slot name="title" />
        </span>
      </span>
      <span
        class="svg aiFoldChevron"
        aria-hidden="true"
        v-html="icons.foldChevron"
      />
    </summary>
    <div
      v-if="showContent"
      class="aiFoldContent"
      tabindex="-1"
      @pointerdown="onContentPointerDown"
    >
      <slot />
    </div>
  </details>
</template>

<style scoped>
.aiFold {
  margin: 0 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--fg) 4%, transparent);
  overflow: hidden;
  background: var(--panel);
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  flex-shrink: 0;
}

.aiFold--tool:last-of-type {
  margin-bottom: 10px;
}

.aiFold--liveThink {
  border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
}

.aiFoldSummary {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 6px 6px;
  font-size: 12px;
  color: var(--muted);
  user-select: none;
  width: 100%;
  box-sizing: border-box;
  background: var(--bg);
}

.aiFoldSummary:hover {
  background: var(--icon-btn-bg-hover);
}

.aiFoldSummary::-webkit-details-marker {
  display: none;
}

.aiFoldSummaryLead {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.aiFoldSummaryLead--tool {
  align-items: center;
}

.aiFoldLeadIcon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.aiFoldLeadIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.aiFoldChevron {
  flex-shrink: 0;
  margin-left: auto;
  color: color-mix(in srgb, var(--muted) 85%, var(--fg));
  transition: transform 0.22s ease;
}

.aiFoldChevron :deep(svg) {
  width: 10px;
  height: 10px;
  display: block;
}

.aiFoldChevron :deep(svg path) {
  fill: currentColor;
}

.aiFold[open] > .aiFoldSummary .aiFoldChevron {
  transform: rotate(180deg);
}

.aiFoldLeadIcon :deep(.aiFoldSummary__icon svg path) {
  fill: currentColor;
}

.aiFoldContent {
  border-top: 1px solid var(--border);
  outline: none;
  min-width: 0;
  min-height: 32px;
  box-sizing: border-box;
}

.aiFoldContent:focus-visible {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
}

/* 默认插槽来自父组件，节点带父级 scoped；须从 .aiFoldContent :deep 才能命中 */
.aiFoldContent :deep(.aiFoldBody) {
  margin: 0;
  padding: 10px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  color: color-mix(in srgb, var(--fg) 88%, var(--muted));
  max-height: 240px;
  overflow-y: auto;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  user-select: text;
  -webkit-user-select: text;
}

.aiFoldContent :deep(.aiFoldBody--thinking) {
  max-height: 180px;
}

/* #icon 插槽由父组件编译，节点带父级 scoped；须 :deep 才能命中（与 .aiFoldBody 注释同理） */
.aiFoldLeadIcon :deep(.aiThinkingPulse) {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: color-mix(in srgb, #3b82f6 75%, var(--accent) 25%);
  animation: aiThinkingPulseBreathe 1.25s ease-in-out infinite;
}

@keyframes aiThinkingPulseBreathe {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.92);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

/* 工具结果图标在 #icon 插槽（父组件编译），经 .aiFoldLeadIcon :deep 命中 */
.aiFoldLeadIcon :deep(.aiToolOutcomeIcon) {
  flex-shrink: 0;
  color: var(--success);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.aiFoldLeadIcon :deep(.aiToolOutcomeIcon svg path) {
  fill: currentColor;
}

.aiFoldLeadIcon :deep(.aiToolOutcomeIcon--fail) {
  color: var(--danger);
}

.aiFoldTitle {
  font-weight: 600;
  color: var(--fg);
  flex-shrink: 0;
  flex: 1;
  min-width: 0;
}
</style>
