<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppModal from "./AppModal.vue";

export type SkillEditModalMode = "builtin" | "custom" | "create";

const props = withDefaults(
  defineProps<{
    mode: SkillEditModalMode;
    /** 打开时用于填充表单 */
    initialTitle: string;
    initialDescription: string;
    initialPrompt: string;
  }>(),
  {
    initialTitle: "",
    initialDescription: "",
    initialPrompt: "",
  },
);

const emit = defineEmits<{
  save: [payload: { title: string; description: string; prompt: string }];
}>();

const open = defineModel<boolean>({ default: false });

const titleField = ref("");
const descriptionField = ref("");
const promptField = ref("");

const modalTitle = computed(() => {
  switch (props.mode) {
    case "create":
      return "添加技能";
    case "custom":
      return "编辑技能";
    default:
      return "查看技能";
  }
});

const titleLocked = computed(() => props.mode === "builtin");

watch(open, (isOpen) => {
  if (!isOpen) return;
  titleField.value = props.initialTitle;
  descriptionField.value = props.initialDescription;
  promptField.value = props.initialPrompt;
});

function onCancel() {
  open.value = false;
}

function onSave() {
  const title = titleField.value.trim();
  if (!titleLocked.value && !title) {
    alert("请填写技能名称。");
    return;
  }
  emit("save", {
    title: titleLocked.value ? props.initialTitle.trim() : title,
    description: descriptionField.value.trim(),
    prompt: promptField.value,
  });
  open.value = false;
}
</script>

<template>
  <AppModal
    v-model="open"
    :title="modalTitle"
    max-width="520px"
    panel-class="skillEditModalPanel"
    :mask-closable="false"
    :esc-closable="true"
    :body-scroll="true"
  >
    <div class="skillEditBody">
      <div class="skillEditField">
        <label class="skillEditLabel" for="skill-edit-title">技能名称</label>
        <input
          id="skill-edit-title"
          v-model="titleField"
          type="text"
          class="skillEditInput"
          :disabled="titleLocked"
          autocomplete="off"
        />
        <p v-if="titleLocked" class="skillEditHint">
          内置技能名称不可修改
        </p>
      </div>

      <div class="skillEditField">
        <label class="skillEditLabel" for="skill-edit-desc">技能描述</label>
        <input
          id="skill-edit-desc"
          v-model="descriptionField"
          type="text"
          class="skillEditInput"
          autocomplete="off"
        />
      </div>

      <div class="skillEditField skillEditField--grow">
        <label class="skillEditLabel" for="skill-edit-prompt">技能提示词</label>
        <textarea
          id="skill-edit-prompt"
          v-model="promptField"
          class="skillEditTextarea"
          spellcheck="false"
        />
      </div>
    </div>

    <template #footer>
      <div class="skillEditFooter">
        <button type="button" class="btn" @click="onCancel">取消</button>
        <button type="button" class="btn primary" @click="onSave">保存</button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
.skillEditBody {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  flex: 1 1 auto;
}

.skillEditField {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.skillEditField--grow {
  flex: 1 1 auto;
  min-height: 120px;
}

.skillEditLabel {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
}

.skillEditHint {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.35;
}

.skillEditInput {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg, var(--control-bg));
  color: var(--fg);
  font-size: 13px;
  font-family: inherit;
}

.skillEditInput:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}

.skillEditTextarea {
  box-sizing: border-box;
  width: 100%;
  flex: 1 1 auto;
  min-height: 160px;
  resize: vertical;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg, var(--control-bg));
  color: var(--fg);
  font-size: 13px;
  line-height: 1.45;
  font-family: inherit;
}

.skillEditFooter {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
}
</style>

<style>
:deep(.skillEditModalPanel) {
  max-height: min(560px, calc(100vh - 40px));
  display: flex;
  flex-direction: column;
}
</style>
