<script setup lang="ts">
export type SettingsTabId = "general" | "reading" | "ai" | "skills";

defineProps<{
  activeTab: SettingsTabId;
}>();

const emit = defineEmits<{
  "update:activeTab": [value: SettingsTabId];
}>();
</script>

<template>
  <div class="settingsTabBar" role="tablist" aria-label="设置分类">
    <div class="tabs">
      <button
        type="button"
        role="tab"
        class="tabBtn"
        :class="{ active: activeTab === 'general' }"
        :aria-selected="activeTab === 'general'"
        @click="emit('update:activeTab', 'general')"
      >
        常规
      </button>
      <button
        type="button"
        role="tab"
        class="tabBtn"
        :class="{ active: activeTab === 'reading' }"
        :aria-selected="activeTab === 'reading'"
        @click="emit('update:activeTab', 'reading')"
      >
        阅读
      </button>
      <button
        type="button"
        role="tab"
        class="tabBtn"
        :class="{ active: activeTab === 'ai' }"
        :aria-selected="activeTab === 'ai'"
        @click="emit('update:activeTab', 'ai')"
      >
        AI
      </button>
      <button
        type="button"
        role="tab"
        class="tabBtn"
        :class="{ active: activeTab === 'skills' }"
        :aria-selected="activeTab === 'skills'"
        @click="emit('update:activeTab', 'skills')"
      >
        技能
      </button>
    </div>
  </div>
</template>

<style scoped>
.settingsTabBar {
  flex-shrink: 0;
  margin-bottom: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.tabBtn {
  box-sizing: border-box;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--tab-fg);
  font-size: 14px;
  padding: 8px 10px;
  cursor: pointer;
  white-space: nowrap;
  line-height: 1.2;
  display: inline-flex;
  align-items: center;
}

.tabBtn:hover {
  color: var(--tab-fg-hover);
}

.tabBtn.active {
  color: var(--tab-fg-active);
  border-bottom: 2px solid var(--tab-underline);
  font-weight: 600;
}
</style>
