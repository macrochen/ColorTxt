<script setup lang="ts">
import { ref, watch } from "vue";
import { icons } from "../icons";

const props = defineProps<{
  url: string;
}>();

const svgMarkup = ref("");

watch(
  () => props.url,
  async (url) => {
    svgMarkup.value = "";
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const text = (await res.text()).trim();
      if (!/<svg\b/i.test(text)) return;
      svgMarkup.value = text;
    } catch {
      /* ignore */
    }
  },
  { immediate: true },
);
</script>

<template>
  <span
    class="extensionActivityIcon"
    :class="{ activityIcon: !svgMarkup }"
    aria-hidden="true"
    v-html="svgMarkup || icons.extension"
  />
</template>

<style scoped>
.extensionActivityIcon {
  line-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.extensionActivityIcon :deep(svg) {
  width: 22px;
  height: 22px;
  display: block;
}
</style>
