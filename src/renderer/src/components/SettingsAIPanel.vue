<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { AIConfig } from "@shared/aiTypes";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import NumericInput from "./NumericInput.vue";
import RangeSlider from "./RangeSlider.vue";
import { icons } from "../icons";
import { appAlert } from "../services/appDialog";

const modelValue = defineModel<AIConfig>({ required: true });

const selectListsEmpty: CustomSelectItem[] = [];

type AiTestPhase = "idle" | "pending" | "ok" | "fail";

const showChatKey = ref(false);
const chatModelsLoading = ref(false);
type PullFlashPhase = "idle" | "loading" | "success" | "fail";
const chatPullFlashPhase = ref<PullFlashPhase>("idle");
let chatPullFlashTimer: ReturnType<typeof setTimeout> | null = null;
const chatTestPhase = ref<AiTestPhase>("idle");
const chatModelOptions = ref<string[]>([]);

const chatLastResolvedFingerprint = ref<string | null>(null);

const chatEndpointFingerprint = computed(() => {
  const c = modelValue.value.chat;
  return `${c.baseUrl.trim()}\0${c.apiKey}\0${c.model.trim()}`;
});

watch(chatEndpointFingerprint, (fp) => {
  if (chatTestPhase.value === "pending") return;
  if (chatLastResolvedFingerprint.value === null) return;
  if (fp !== chatLastResolvedFingerprint.value) {
    chatTestPhase.value = "idle";
    chatLastResolvedFingerprint.value = null;
  }
});

const chatModelScrollItems = computed((): CustomSelectItem[] =>
  chatModelOptions.value.map((m) => ({
    kind: "item",
    id: m,
    label: m,
  })),
);

const chatModelDisplayLabel = computed(() => {
  const m = modelValue.value.chat.model.trim();
  return m || "选择模型…";
});

const chatTestIconHtml = computed(() => {
  switch (chatTestPhase.value) {
    case "pending":
      return icons.refresh;
    case "ok":
      return icons.success;
    case "fail":
      return icons.fail;
    default:
      return icons.unknow;
  }
});

const chatPullIconHtml = computed(() => {
  switch (chatPullFlashPhase.value) {
    case "success":
      return icons.success;
    case "fail":
      return icons.fail;
    default:
      return icons.refresh;
  }
});

async function refreshChatModels(opts?: { buttonFlash?: boolean }) {
  if (opts?.buttonFlash) {
    if (chatPullFlashTimer != null) {
      clearTimeout(chatPullFlashTimer);
      chatPullFlashTimer = null;
    }
    chatPullFlashPhase.value = "loading";
  }
  chatModelsLoading.value = true;
  let ok = false;
  try {
    const r = await window.colorTxt.ai.modelsList({
      baseUrl: modelValue.value.chat.baseUrl,
      apiKey: modelValue.value.chat.apiKey,
    });
    ok = r.ok;
    if (r.ok) {
      chatModelOptions.value = r.models;
      if (!modelValue.value.chat.model.trim() && r.models.length > 0) {
        modelValue.value.chat.model = r.models[0];
      }
    } else chatModelOptions.value = [];
  } finally {
    chatModelsLoading.value = false;
    if (!opts?.buttonFlash && ok && chatPullFlashPhase.value === "fail") {
      chatPullFlashPhase.value = "idle";
    }
    if (opts?.buttonFlash) {
      if (ok) {
        chatPullFlashPhase.value = "success";
        chatPullFlashTimer = setTimeout(() => {
          chatPullFlashPhase.value = "idle";
          chatPullFlashTimer = null;
        }, 1000);
      } else {
        if (chatPullFlashTimer != null) {
          clearTimeout(chatPullFlashTimer);
          chatPullFlashTimer = null;
        }
        chatPullFlashPhase.value = "fail";
      }
    }
  }
}

function onChatModelPanelOpenChange(isOpen: boolean) {
  if (!isOpen || chatModelsLoading.value) return;
  if (chatModelOptions.value.length > 0) return;
  void refreshChatModels();
}

function addQuickQuestion() {
  modelValue.value.quickQuestions.push("");
}

function removeQuickQuestion(i: number) {
  const q = modelValue.value.quickQuestions;
  if (q.length <= 1) return;
  q.splice(i, 1);
}

function canMoveQuickQuestionUp(i: number): boolean {
  return i > 0;
}

function canMoveQuickQuestionDown(i: number): boolean {
  const q = modelValue.value.quickQuestions;
  return q.length > 1 && i < q.length - 1;
}

function moveQuickQuestionUp(i: number) {
  if (!canMoveQuickQuestionUp(i)) return;
  const q = modelValue.value.quickQuestions;
  const [row] = q.splice(i, 1);
  q.splice(i - 1, 0, row);
}

function moveQuickQuestionDown(i: number) {
  if (!canMoveQuickQuestionDown(i)) return;
  const q = modelValue.value.quickQuestions;
  const [row] = q.splice(i, 1);
  q.splice(i + 1, 0, row);
}

async function testChat() {
  if (chatTestPhase.value === "pending") return;
  chatTestPhase.value = "pending";
  const fpWhenStarted = chatEndpointFingerprint.value;
  try {
    const r = await window.colorTxt.ai.testChat({
      baseUrl: modelValue.value.chat.baseUrl,
      apiKey: modelValue.value.chat.apiKey,
      model: modelValue.value.chat.model,
    });
    if (chatEndpointFingerprint.value !== fpWhenStarted) {
      chatTestPhase.value = "idle";
      chatLastResolvedFingerprint.value = null;
      return;
    }
    if (r.ok) {
      chatTestPhase.value = "ok";
      chatLastResolvedFingerprint.value = fpWhenStarted;
    } else {
      await appAlert(r.error);
      chatTestPhase.value = "fail";
      chatLastResolvedFingerprint.value = fpWhenStarted;
    }
  } catch (e) {
    if (chatEndpointFingerprint.value !== fpWhenStarted) {
      chatTestPhase.value = "idle";
      chatLastResolvedFingerprint.value = null;
      return;
    }
    await appAlert(e instanceof Error ? e.message : String(e));
    chatTestPhase.value = "fail";
    chatLastResolvedFingerprint.value = fpWhenStarted;
  }
}

onBeforeUnmount(() => {
  if (chatPullFlashTimer != null) {
    clearTimeout(chatPullFlashTimer);
    chatPullFlashTimer = null;
  }
});
</script>

<template>
  <div class="settingsBody">
    <section class="aiSection">
      <h3 class="aiSectionTitle">对话模型</h3>
      <div class="settingsRow">
        <span class="settingsLabel small">接口地址</span>
        <input
          v-model="modelValue.chat.baseUrl"
          type="text"
          autocomplete="off"
          placeholder="http://localhost:1234/v1"
          class="settingsStretchInput"
        />
      </div>
      <div class="settingsRow">
        <span class="settingsLabel small">API 密钥</span>
        <div class="settingsPasswordRow">
          <input
            v-model="modelValue.chat.apiKey"
            class="settingsStretchInput settingsPasswordRow__input"
            :type="showChatKey ? 'text' : 'password'"
            autocomplete="off"
            spellcheck="false"
          />
          <button
            type="button"
            class="btn iconOnly"
            :title="showChatKey ? '隐藏' : '显示'"
            @click="showChatKey = !showChatKey"
          >
            <span
              class="iconSvg"
              v-html="showChatKey ? icons.view : icons.viewOff"
            />
          </button>
        </div>
      </div>
      <div class="settingsRow">
        <span class="settingsLabel small">模型</span>
        <div class="aiModelToolbar">
          <AppCustomSelect
            class="aiModelSelect"
            :model-value="modelValue.chat.model"
            :display-label="chatModelDisplayLabel"
            :fixed-top-items="selectListsEmpty"
            :scroll-items="chatModelScrollItems"
            :fixed-bottom-items="selectListsEmpty"
            :scroll-max-height="260"
            ariaLabel="对话模型"
            @panel-open-change="onChatModelPanelOpenChange"
            @update:model-value="modelValue.chat.model = $event"
          />
          <button
            type="button"
            class="btn"
            :class="{
              success: chatPullFlashPhase === 'success',
              danger: chatPullFlashPhase === 'fail',
            }"
            :disabled="chatModelsLoading"
            @click="refreshChatModels({ buttonFlash: true })"
          >
            <span
              class="iconSvg"
              :class="{
                'iconSvg--spinning':
                  chatModelsLoading || chatPullFlashPhase === 'loading',
              }"
              v-html="chatPullIconHtml"
            />
            拉取模型
          </button>
          <button
            type="button"
            class="btn"
            :class="{
              success: chatTestPhase === 'ok',
              danger: chatTestPhase === 'fail',
            }"
            :disabled="chatTestPhase === 'pending'"
            @click="testChat"
          >
            <span
              class="iconSvg"
              :class="{ 'iconSvg--spinning': chatTestPhase === 'pending' }"
              v-html="chatTestIconHtml"
            />
            测试连接
          </button>
        </div>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel"
            >温度（{{ modelValue.chat.temperature }}）</span
          >
          <RangeSlider
            v-model="modelValue.chat.temperature"
            :min="0"
            :max="1"
            :step="0.1"
            :show-percent="false"
            class="temperatureSlider"
          />
        </div>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel"
            >最大 Token 数（{{ modelValue.chat.maxTokens }}）</span
          >
          <NumericInput
            v-model="modelValue.chat.maxTokens"
            :min="256"
            :max="128000"
            integer
            class="numCompact"
          />
        </div>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel"
            >上下文长度（{{ modelValue.chat.slidingWindowSize }} 轮）</span
          >
          <NumericInput
            v-model="modelValue.chat.slidingWindowSize"
            :min="1"
            :max="64"
            integer
            class="numCompact"
          />
        </div>
      </div>
    </section>

    <section class="aiSection quickQSection">
      <h3 class="aiSectionTitle">快速提问</h3>
      <div
        v-for="(_q, i) in modelValue.quickQuestions"
        :key="i"
        class="quickQRow"
      >
        <input
          v-model="modelValue.quickQuestions[i]"
          type="text"
          class="settingsStretchInput quickQInput"
          autocomplete="off"
          spellcheck="false"
          placeholder="提问内容…"
        />
        <div class="quickQRowActions">
          <button
            type="button"
            class="btn iconOnly quickQReorder"
            title="上移"
            :disabled="!canMoveQuickQuestionUp(i)"
            @click="moveQuickQuestionUp(i)"
          >
            <span class="iconSvg" v-html="icons.up" />
          </button>
          <button
            type="button"
            class="btn iconOnly quickQReorder"
            title="下移"
            :disabled="!canMoveQuickQuestionDown(i)"
            @click="moveQuickQuestionDown(i)"
          >
            <span class="iconSvg" v-html="icons.down" />
          </button>
          <button
            type="button"
            class="btn iconOnly quickQRemove"
            title="删除"
            :disabled="modelValue.quickQuestions.length <= 1"
            @click="removeQuickQuestion(i)"
          >
            <span class="iconSvg" v-html="icons.remove" />
          </button>
        </div>
      </div>
      <button type="button" class="btn quickQAdd" @click="addQuickQuestion">
        <span class="iconSvg" v-html="icons.add" />
        添加一项
      </button>
    </section>
  </div>
</template>

<style scoped>
.settingsBody {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.aiSection {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px;
  background-color: var(--bg);
  border-radius: 8px;
}

.aiSectionTitle {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}

.settingsRow {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settingsRowMain {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}

.settingsRowMain--baseline {
  align-items: baseline;
}

.settingsLabel {
  font-size: 14px;
  color: var(--fg);
  white-space: nowrap;
  flex: 1 1 60%;
}

.settingsLabel.small {
  font-size: 12px;
  color: var(--muted);
}

.quickQSection {
  gap: 5px;
}
.quickQSection .aiSectionTitle {
  margin-bottom: 15px;
}

.settingsStretchInput,
.settingsStretchTextarea {
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
  resize: none;
}

.settingsPasswordRow {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}

.settingsPasswordRow__input {
  flex: 1;
  min-width: 0;
}

.iconOnly {
  padding: 6px;
  flex-shrink: 0;
}

.iconSvg :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;

  path {
    fill: currentColor;
  }
}

.iconSvg.iconSvg--spinning :deep(svg) {
  animation: aiSettingsIconSpin 0.65s linear infinite;
}

@keyframes aiSettingsIconSpin {
  to {
    transform: rotate(360deg);
  }
}

.aiModelToolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.aiModelToolbar .btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.aiModelToolbar .btn.success .iconSvg :deep(path),
.aiModelToolbar .btn.danger .iconSvg :deep(path) {
  fill: currentColor;
}

.aiModelSelect {
  flex: 1 1 160px;
  min-width: 0;
}

.temperatureSlider {
  width: 150px;
}

.numCompact {
  width: 120px;
}

.quickQRow {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}

.quickQInput {
  flex: 1;
  min-width: 0;
}

.quickQRowActions {
  display: flex;
  align-items: stretch;
  gap: 4px;
  flex-shrink: 0;
}

.quickQReorder,
.quickQRemove {
  flex-shrink: 0;
}

.quickQRowActions .btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.quickQRemove:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}

.quickQAdd {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
}

.quickQAdd .iconSvg :deep(svg) {
  width: 16px;
  height: 16px;
}
</style>
