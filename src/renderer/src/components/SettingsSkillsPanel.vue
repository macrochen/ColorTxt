<script setup lang="ts">
import { computed, ref } from "vue";
import type { AiCustomSkill, AiSkillUserOverride } from "@shared/aiSkills";
import {
  BUILTIN_AI_SKILLS,
  effectiveBuiltinSkill,
} from "@shared/aiSkills";
import SettingsSkillEditModal, {
  type SkillEditModalMode,
} from "./SettingsSkillEditModal.vue";
import SwitchToggle from "./SwitchToggle.vue";
import { icons } from "../icons";

const enabled = defineModel<Record<string, boolean>>("enabled", {
  required: true,
});
const overrides = defineModel<Record<string, AiSkillUserOverride>>(
  "overrides",
  { required: true },
);
const customSkills = defineModel<AiCustomSkill[]>("customSkills", {
  required: true,
});

const editOpen = ref(false);
const editMode = ref<SkillEditModalMode>("builtin");
const editInitialTitle = ref("");
const editInitialDescription = ref("");
const editInitialPrompt = ref("");
const editingBuiltinId = ref<string | null>(null);
const editingCustomId = ref<string | null>(null);

function skillOn(id: string): boolean {
  return enabled.value[id] !== false;
}

function setSkill(id: string, on: boolean) {
  enabled.value = { ...enabled.value, [id]: on };
}

const builtinCards = computed(() =>
  BUILTIN_AI_SKILLS.map((def) => {
    const ov = overrides.value[def.id];
    const eff = effectiveBuiltinSkill(def, ov);
    return {
      kind: "builtin" as const,
      id: def.id,
      title: def.title,
      description: eff.description,
    };
  }),
);

function openEditBuiltin(id: string) {
  const def = BUILTIN_AI_SKILLS.find((s) => s.id === id);
  if (!def) return;
  const eff = effectiveBuiltinSkill(def, overrides.value[id]);
  editingBuiltinId.value = id;
  editingCustomId.value = null;
  editMode.value = "builtin";
  editInitialTitle.value = def.title;
  editInitialDescription.value = eff.description;
  editInitialPrompt.value = eff.prompt;
  editOpen.value = true;
}

function openEditCustom(skill: AiCustomSkill) {
  editingBuiltinId.value = null;
  editingCustomId.value = skill.id;
  editMode.value = "custom";
  editInitialTitle.value = skill.title;
  editInitialDescription.value = skill.description;
  editInitialPrompt.value = skill.prompt;
  editOpen.value = true;
}

function openCreateSkill() {
  editingBuiltinId.value = null;
  editingCustomId.value = null;
  editMode.value = "create";
  editInitialTitle.value = "";
  editInitialDescription.value = "";
  editInitialPrompt.value = "";
  editOpen.value = true;
}

function onSkillModalSave(payload: {
  title: string;
  description: string;
  prompt: string;
}) {
  if (editMode.value === "builtin" && editingBuiltinId.value) {
    const id = editingBuiltinId.value;
    overrides.value = {
      ...overrides.value,
      [id]: { description: payload.description, prompt: payload.prompt },
    };
    return;
  }
  if (editMode.value === "custom" && editingCustomId.value) {
    const id = editingCustomId.value;
    customSkills.value = customSkills.value.map((s) =>
      s.id === id
        ? {
            ...s,
            title: payload.title,
            description: payload.description,
            prompt: payload.prompt,
          }
        : s,
    );
    return;
  }
  if (editMode.value === "create") {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    customSkills.value = [
      ...customSkills.value,
      {
        id,
        title: payload.title,
        description: payload.description,
        prompt: payload.prompt,
        createdAt,
      },
    ];
    enabled.value = { ...enabled.value, [id]: true };
  }
}

function formatSkillTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
</script>

<template>
  <div class="settingsBody settingsBody--skills">
    <header class="skillsHeader">
      <div class="skillsHeaderText">
        <h2 class="skillsTitle">技能</h2>
        <p class="skillsSubtitle">
          管理 AI 工具扩展（后续可在对话中自动匹配启用项）
        </p>
      </div>
      <button type="button" class="btn skillsAddBtn" @click="openCreateSkill">
        + 添加技能
      </button>
    </header>

    <div class="skillsGrid" role="list">
      <article
        v-for="card in builtinCards"
        :key="card.id"
        class="skillCard"
        role="listitem"
      >
        <div class="skillCardTop">
          <h3 class="skillCardTitle">{{ card.title }}</h3>
          <button
            type="button"
            class="skillCardEdit"
            title="编辑"
            aria-label="编辑"
            @click="openEditBuiltin(card.id)"
          >
            <span class="svg" v-html="icons.edit" />
          </button>
        </div>
        <p class="skillCardDesc">{{ card.description }}</p>
        <div class="skillCardFoot">
          <div class="skillCardTags">
            <span class="skillTag skillTag--builtin">内置</span>
            <span
              class="skillTag"
              :class="skillOn(card.id) ? 'skillTag--on' : 'skillTag--off'"
            >
              {{ skillOn(card.id) ? "已启用" : "未启用" }}
            </span>
          </div>
          <SwitchToggle
            size="sm"
            :model-value="skillOn(card.id)"
            :ariaLabel="`${card.title}，是否启用`"
            @update:model-value="setSkill(card.id, $event)"
          />
        </div>
      </article>

      <article
        v-for="skill in customSkills"
        :key="skill.id"
        class="skillCard"
        role="listitem"
      >
        <div class="skillCardTop">
          <h3 class="skillCardTitle">{{ skill.title }}</h3>
          <button
            type="button"
            class="skillCardEdit"
            title="编辑"
            aria-label="编辑"
            @click="openEditCustom(skill)"
          >
            <span class="svg" v-html="icons.edit" />
          </button>
        </div>
        <p class="skillCardDesc">{{ skill.description }}</p>
        <div class="skillCardFoot">
          <div class="skillCardTags">
            <span class="skillTag skillTag--custom">自定义</span>
            <span
              class="skillTag"
              :class="skillOn(skill.id) ? 'skillTag--on' : 'skillTag--off'"
            >
              {{ skillOn(skill.id) ? "已启用" : "未启用" }}
            </span>
          </div>
          <div class="skillCardFootEnd">
            <span class="skillCardTime">{{ formatSkillTime(skill.createdAt) }}</span>
            <SwitchToggle
              size="sm"
              :model-value="skillOn(skill.id)"
              :ariaLabel="`${skill.title}，是否启用`"
              @update:model-value="setSkill(skill.id, $event)"
            />
          </div>
        </div>
      </article>
    </div>

    <SettingsSkillEditModal
      v-model="editOpen"
      :mode="editMode"
      :initial-title="editInitialTitle"
      :initial-description="editInitialDescription"
      :initial-prompt="editInitialPrompt"
      @save="onSkillModalSave"
    />
  </div>
</template>

<style scoped>
.settingsBody--skills {
  padding-left: 10px;
  padding-right: 10px;
}

.skillsHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.skillsHeaderText {
  min-width: 0;
}

.skillsTitle {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 700;
  color: var(--fg);
  line-height: 1.25;
}

.skillsSubtitle {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
}

.skillsAddBtn {
  flex-shrink: 0;
}

.skillsGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 520px) {
  .skillsGrid {
    grid-template-columns: 1fr;
  }
}

.skillCard {
  box-sizing: border-box;
  padding: 12px 12px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--reader-bg, var(--panel)) 35%, var(--panel));
}

.skillCardTop {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.skillCardTitle {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--fg);
  line-height: 1.3;
}

.skillCardEdit {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.skillCardEdit:hover {
  color: var(--fg);
  background: color-mix(in srgb, var(--fg) 8%, transparent);
}

.skillCardEdit .svg :deep(svg) {
  width: 15px;
  height: 15px;
  display: block;
}

.skillCardEdit .svg :deep(path) {
  fill: currentColor;
}

.skillCardDesc {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
  min-height: 3em;
}

.skillCardFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.skillCardFootEnd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.skillCardTime {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}

.skillCardTags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.skillTag {
  font-size: 11px;
  line-height: 1.2;
  padding: 3px 8px;
  border-radius: 999px;
  white-space: nowrap;
}

.skillTag--builtin {
  background: color-mix(in srgb, var(--fg) 8%, transparent);
  color: var(--secondary);
}

.skillTag--custom {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

.skillTag--on {
  background: var(--fg);
  color: var(--bg);
}

.skillTag--off {
  background: color-mix(in srgb, var(--fg) 6%, transparent);
  color: var(--muted);
}
</style>
