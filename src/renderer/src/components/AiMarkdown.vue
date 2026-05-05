<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";

const props = defineProps<{
  source: string;
}>();

const html = computed(() => {
  const staged = props.source.replace(
    /\(ch=(\d+)\)/g,
    "[[COLORTXT_CH:$1]]",
  );
  let out = marked.parse(staged, { breaks: true, async: false }) as string;
  out = out.replace(
    /\[\[COLORTXT_CH:(\d+)\]\]/g,
    '<button type="button" class="aiChRef" data-ch="$1">第 $1 章</button>',
  );
  return out;
});

const emit = defineEmits<{
  chapterClick: [chapterIndex1Based: number];
}>();

function onClick(e: MouseEvent) {
  const t = (e.target as HTMLElement).closest(
    "button.aiChRef[data-ch]",
  ) as HTMLElement | null;
  if (!t) return;
  e.preventDefault();
  const n = Number.parseInt(t.getAttribute("data-ch") ?? "", 10);
  if (Number.isFinite(n) && n >= 1) emit("chapterClick", n);
}
</script>

<template>
  <div class="aiMarkdown" @click="onClick" v-html="html" />
</template>

<style scoped>
.aiMarkdown {
  font-size: 13px;
  line-height: 1.55;
  color: var(--fg);
  word-break: break-word;
}

.aiMarkdown :deep(p) {
  margin: 0 0 0.6em;
}

.aiMarkdown :deep(p:last-child) {
  margin-bottom: 0;
}

.aiMarkdown :deep(pre) {
  overflow: auto;
  padding: 8px;
  border-radius: 6px;
  background: var(--reader-bg, var(--bg));
  border: 1px solid var(--border);
}

.aiMarkdown :deep(code) {
  font-family: var(--mono-font, ui-monospace, monospace);
  font-size: 12px;
}

.aiMarkdown :deep(.aiChRef) {
  display: inline;
  margin: 0 2px;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
  vertical-align: baseline;
}

.aiMarkdown :deep(.aiChRef:hover) {
  filter: brightness(1.08);
}
</style>
