<script setup lang="ts">
import { onMounted, ref } from "vue";
import AppContextMenu from "./AppContextMenu.vue";
import SwitchToggle from "./SwitchToggle.vue";
import { icons } from "../icons";

const emit = defineEmits<{
  didChange: [];
  reloadViews: [];
}>();

type Row = Awaited<ReturnType<typeof window.colorTxt.extensionList>>[number];

const rows = ref<Row[]>([]);
const busy = ref(false);
const message = ref("");
const activeMenuRowName = ref<string | null>(null);
const menuX = ref(0);
const menuY = ref(0);
const rowMenuItems = [
  { id: "reload", label: "重新加载扩展" },
  { id: "sep-1", separator: true },
  { id: "reveal", label: "打开扩展目录" },
] as const;

async function load() {
  try {
    rows.value = await window.colorTxt.extensionList();
  } catch {
    rows.value = [];
  }
}

onMounted(() => void load());

async function openAddDialog() {
  message.value = "";
  const p = await window.colorTxt.openCtixDialog();
  if (!p) return;
  busy.value = true;
  try {
    const r = await window.colorTxt.extensionInstallFromCtix(p);
    if (!r.ok) message.value = r.error;
    else {
      await window.colorTxt.extensionRefreshRoots();
      await load();
      emit("didChange");
      emit("reloadViews");
    }
  } finally {
    busy.value = false;
  }
}

async function onToggle(row: Row, enabled: boolean) {
  busy.value = true;
  try {
    const r = await window.colorTxt.extensionSetEnabled({
      name: row.name,
      enabled,
      builtin: row.builtin,
    });
    if (!r.ok) message.value = r.error ?? "设置失败";
    else {
      await window.colorTxt.extensionRefreshRoots();
      await load();
      emit("didChange");
      emit("reloadViews");
    }
  } finally {
    busy.value = false;
  }
}

function onReloadViews() {
  emit("reloadViews");
}

function closeRowMenu() {
  activeMenuRowName.value = null;
}

function toggleRowMenu(row: Row) {
  activeMenuRowName.value =
    activeMenuRowName.value === row.name ? null : row.name;
}

function onReloadFromRowMenu() {
  onReloadViews();
  closeRowMenu();
}

function onOpenExtensionDir(row: Row) {
  void window.colorTxt.showItemInFolder(row.rootFsPath).catch(() => {});
  closeRowMenu();
}

function onMenuBtnClick(row: Row, ev: MouseEvent) {
  const btn = ev.currentTarget as HTMLElement | null;
  if (btn) {
    const r = btn.getBoundingClientRect();
    menuX.value = Math.round(r.right - 6);
    menuY.value = Math.round(r.bottom + 6);
  }
  toggleRowMenu(row);
}

function onRowMenuSelect(actionId: string) {
  const row = rows.value.find((it) => it.name === activeMenuRowName.value);
  if (!row) return;
  if (actionId === "reload") {
    onReloadFromRowMenu();
    return;
  }
  if (actionId === "reveal") {
    onOpenExtensionDir(row);
  }
}

defineExpose({ reload: load, openAddDialog });
</script>

<template>
  <div class="extensionsPanel">
    <p v-if="message" class="extensionsMsg">{{ message }}</p>
    <ul class="extensionsList">
      <li
        v-for="row in rows"
        :key="row.name"
        class="extensionsRow"
        :class="{ 'extensionsRow--disabled': !row.enabled }"
      >
        <div class="extensionsRowMain">
          <div class="extensionsTitleRow">
            <span class="extensionsName">{{ row.displayName }}</span>
            <span v-if="row.builtin" class="badge">内置</span>
            <span v-if="row.dev" class="badge badgeDev">dev</span>
          </div>
          <p class="extensionsDesc">{{ row.description || "（无描述）" }}</p>
          <p class="extensionsMeta">v{{ row.version }}</p>
        </div>
        <div class="extensionsRowActions">
          <SwitchToggle
            size="sm"
            :model-value="row.enabled"
            :disabled="busy"
            aria-label="启用扩展"
            @update:model-value="onToggle(row, $event)"
          />
          <div class="extensionsMenu">
            <button
              type="button"
              class="extensionsMenuBtn"
              :disabled="busy"
              title="管理"
              aria-label="管理"
              @click.stop="onMenuBtnClick(row, $event)"
            >
              <span class="extensionsMenuIcon" v-html="icons.setting"></span>
            </button>
          </div>
        </div>
      </li>
    </ul>
    <p v-if="rows.length === 0" class="extensionsEmpty">暂无扩展</p>
    <AppContextMenu
      :open="Boolean(activeMenuRowName)"
      :x="menuX"
      :y="menuY"
      :items="rowMenuItems"
      :min-width="160"
      @close="closeRowMenu"
      @select="onRowMenuSelect"
    />
  </div>
</template>

<style scoped>
.extensionsPanel {
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  flex: 1;
}
.extensionsMsg {
  margin: 0;
  font-size: 12px;
  color: var(--danger, #c62828);
}
.extensionsList {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  flex: 1;
}
.extensionsRow {
  display: flex;
  gap: 10px;
  justify-content: space-between;
  align-items: stretch;
  padding: 10px;
  border-bottom: 1px solid var(--border-muted, rgba(127, 127, 127, 0.25));
}
.extensionsRow:hover {
  background: var(--list-item-bg-hover);
}
.extensionsRow--disabled {
  opacity: 0.5;
}
.extensionsRowMain {
  min-width: 0;
  flex: 1 1 auto;
}
.extensionsTitleRow {
  display: block;
  line-height: 1.35;
}
.extensionsName {
  font-size: 13px;
  font-weight: 600;
  display: inline;
}
.badge {
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--badge-bg, rgba(127, 127, 127, 0.25));
  margin-left: 6px;
  vertical-align: middle;
}
.badgeDev {
  background: rgba(33, 150, 243, 0.25);
}
.extensionsDesc {
  margin: 4px 0 0;
  font-size: 12px;
  opacity: 0.85;
}
.extensionsMeta {
  margin: 4px 0 0;
  font-size: 11px;
  opacity: 0.65;
}
.extensionsRowActions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  flex-shrink: 0;
  position: relative;
}
.extensionsMenu {
  position: relative;
}
.extensionsMenuBtn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--tab-fg, #666);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.extensionsMenuBtn:hover {
  /* background: var(--tab-fg-active); */
  color: var(--tab-fg-active, #111);
}
.extensionsMenuIcon {
  line-height: 0;
}
.extensionsMenuIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
  path {
    fill: currentColor;
  }
}
.extensionsEmpty {
  margin: 0;
  padding: 16px 0;
  text-align: center;
  opacity: 0.65;
  font-size: 12px;
}
</style>
