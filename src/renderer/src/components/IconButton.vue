<script setup lang="ts">
withDefaults(
  defineProps<{
    /** SVG 字符串，与 icons.xxx 一致 */
    iconHtml: string;
    title?: string;
    /** 图标按钮无文字时建议设置，便于读屏 */
    ariaLabel?: string;
    active?: boolean;
    /** 有值时设置 aria-pressed（切换型按钮） */
    pressed?: boolean;
    /** 多色 SVG，不强制 path 为 currentColor */
    multicolor?: boolean;
    disabled?: boolean;
    /** 表格操作列等：32×32、图标 18px */
    large?: boolean;
  }>(),
  { active: false, multicolor: false, disabled: false, large: false },
);

defineEmits<{ click: [e: MouseEvent] }>();
</script>

<template>
  <button
    type="button"
    class="iconBtn"
    :class="{ active, large }"
    :title="title"
    :aria-label="ariaLabel"
    :aria-pressed="pressed"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <span
      class="icon"
      :class="{ 'icon--multicolor': multicolor }"
      v-html="iconHtml"
    ></span>
  </button>
</template>

<style scoped>
.iconBtn {
  background: transparent;
  border: none;
  border-radius: 4px;
  width: 30px;
  height: 30px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.16s ease;
}

.iconBtn:hover:not(:disabled) {
  background: var(--icon-btn-bg-hover);
}

.icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  color: var(--icon-btn-fg);
}

.icon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.icon:not(.icon--multicolor) :deep(path) {
  fill: currentColor;
}

.iconBtn:hover:not(:disabled) .icon:not(.icon--multicolor) {
  color: var(--icon-btn-fg);
}

.iconBtn:focus {
  outline: none;
}

.iconBtn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.iconBtn.active {
  background: var(--icon-btn-bg-active);
}

.iconBtn.active .icon:not(.icon--multicolor) {
  color: var(--icon-btn-fg);
}
</style>
