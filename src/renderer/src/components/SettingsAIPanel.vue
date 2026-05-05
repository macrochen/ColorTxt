<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AIConfig } from "@shared/aiTypes";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import NumericInput from "./NumericInput.vue";
import RangeSlider from "./RangeSlider.vue";
import { icons } from "../icons";

const modelValue = defineModel<AIConfig>({ required: true });

const selectListsEmpty: CustomSelectItem[] = [];

type AiTestPhase = "idle" | "pending" | "ok" | "fail";

const showChatKey = ref(false);
const showEmbedKey = ref(false);
const chatModelsLoading = ref(false);
const embedModelsLoading = ref(false);
const chatTestPhase = ref<AiTestPhase>("idle");
const embedTestPhase = ref<AiTestPhase>("idle");
const chatModelOptions = ref<string[]>([]);
const embedModelOptions = ref<string[]>([]);
const embedDimProbing = ref(false);

/** 最近一次「测试连接」完成时的参数快照；与当前不一致则退回未测试态 */
const chatLastResolvedFingerprint = ref<string | null>(null);
const embedLastResolvedFingerprint = ref<string | null>(null);

const chatEndpointFingerprint = computed(() => {
  const c = modelValue.value.chat;
  return `${c.baseUrl.trim()}\0${c.apiKey}\0${c.model.trim()}`;
});

/** 嵌入测试依赖 dimension，一并纳入 */
const embedEndpointFingerprint = computed(() => {
  const e = modelValue.value.embedding;
  return `${e.baseUrl.trim()}\0${e.apiKey}\0${e.model.trim()}\0${e.dimension}`;
});

watch(chatEndpointFingerprint, (fp) => {
  if (chatTestPhase.value === "pending") return;
  if (chatLastResolvedFingerprint.value === null) return;
  if (fp !== chatLastResolvedFingerprint.value) {
    chatTestPhase.value = "idle";
    chatLastResolvedFingerprint.value = null;
  }
});

watch(embedEndpointFingerprint, (fp) => {
  if (embedTestPhase.value === "pending") return;
  if (embedLastResolvedFingerprint.value === null) return;
  if (fp !== embedLastResolvedFingerprint.value) {
    embedTestPhase.value = "idle";
    embedLastResolvedFingerprint.value = null;
  }
});

const chatModelScrollItems = computed((): CustomSelectItem[] =>
  chatModelOptions.value.map((m) => ({
    kind: "item",
    id: m,
    label: m,
  })),
);

const embedModelScrollItems = computed((): CustomSelectItem[] =>
  embedModelOptions.value.map((m) => ({
    kind: "item",
    id: m,
    label: m,
  })),
);

const chatModelDisplayLabel = computed(() => {
  const m = modelValue.value.chat.model.trim();
  return m || "选择模型…";
});

const embedModelDisplayLabel = computed(() => {
  const m = modelValue.value.embedding.model.trim();
  return m || "选择嵌入模型…";
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

const embedTestIconHtml = computed(() => {
  switch (embedTestPhase.value) {
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

async function refreshChatModels() {
  chatModelsLoading.value = true;
  try {
    const r = await window.colorTxt.ai.modelsList({
      baseUrl: modelValue.value.chat.baseUrl,
      apiKey: modelValue.value.chat.apiKey,
    });
    if (r.ok) {
      chatModelOptions.value = r.models;
      if (!modelValue.value.chat.model.trim() && r.models.length > 0) {
        modelValue.value.chat.model = r.models[0];
      }
    } else chatModelOptions.value = [];
  } finally {
    chatModelsLoading.value = false;
  }
}

async function refreshEmbedModels() {
  embedModelsLoading.value = true;
  try {
    const r = await window.colorTxt.ai.modelsList({
      baseUrl: modelValue.value.embedding.baseUrl,
      apiKey: modelValue.value.embedding.apiKey,
    });
    if (r.ok) {
      embedModelOptions.value = r.models;
      if (!modelValue.value.embedding.model.trim() && r.models.length > 0) {
        modelValue.value.embedding.model = r.models[0];
      }
    } else embedModelOptions.value = [];
  } finally {
    embedModelsLoading.value = false;
  }
}

function onChatModelPanelOpenChange(isOpen: boolean) {
  if (!isOpen || chatModelsLoading.value) return;
  if (chatModelOptions.value.length > 0) return;
  void refreshChatModels();
}

function onEmbedModelPanelOpenChange(isOpen: boolean) {
  if (!isOpen || embedModelsLoading.value) return;
  if (embedModelOptions.value.length > 0) return;
  void refreshEmbedModels();
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
      alert(r.error);
      chatTestPhase.value = "fail";
      chatLastResolvedFingerprint.value = fpWhenStarted;
    }
  } catch (e) {
    if (chatEndpointFingerprint.value !== fpWhenStarted) {
      chatTestPhase.value = "idle";
      chatLastResolvedFingerprint.value = null;
      return;
    }
    alert(e instanceof Error ? e.message : String(e));
    chatTestPhase.value = "fail";
    chatLastResolvedFingerprint.value = fpWhenStarted;
  }
}

async function probeEmbedDimension() {
  if (embedDimProbing.value) return;
  const baseUrl = modelValue.value.embedding.baseUrl.trim();
  const model = modelValue.value.embedding.model.trim();
  if (!baseUrl || !model) {
    alert("请先填写 Embedding Base URL 与模型。");
    return;
  }
  embedDimProbing.value = true;
  try {
    const r = await window.colorTxt.ai.embeddingProbeDimension({
      baseUrl: modelValue.value.embedding.baseUrl,
      apiKey: modelValue.value.embedding.apiKey,
      model: modelValue.value.embedding.model,
    });
    if (!r.ok) {
      alert(r.error);
      return;
    }
    modelValue.value.embedding.dimension = r.dimension;
  } finally {
    embedDimProbing.value = false;
  }
}

async function testEmbedding() {
  if (embedTestPhase.value === "pending") return;
  embedTestPhase.value = "pending";
  const fpWhenStarted = embedEndpointFingerprint.value;
  try {
    const r = await window.colorTxt.ai.testEmbedding({
      baseUrl: modelValue.value.embedding.baseUrl,
      apiKey: modelValue.value.embedding.apiKey,
      model: modelValue.value.embedding.model,
      dimension: modelValue.value.embedding.dimension,
    });
    if (embedEndpointFingerprint.value !== fpWhenStarted) {
      embedTestPhase.value = "idle";
      embedLastResolvedFingerprint.value = null;
      return;
    }
    if (r.ok) {
      embedTestPhase.value = "ok";
      embedLastResolvedFingerprint.value = fpWhenStarted;
    } else {
      alert(r.error);
      embedTestPhase.value = "fail";
      embedLastResolvedFingerprint.value = fpWhenStarted;
    }
  } catch (e) {
    if (embedEndpointFingerprint.value !== fpWhenStarted) {
      embedTestPhase.value = "idle";
      embedLastResolvedFingerprint.value = null;
      return;
    }
    alert(e instanceof Error ? e.message : String(e));
    embedTestPhase.value = "fail";
    embedLastResolvedFingerprint.value = fpWhenStarted;
  }
}
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
            :disabled="chatModelsLoading"
            @click="refreshChatModels"
          >
            <span
              class="iconSvg"
              :class="{ 'iconSvg--spinning': chatModelsLoading }"
              v-html="icons.refresh"
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
      <div class="settingsRow">
        <span class="settingsLabel small">附加系统提示词</span>
        <textarea
          v-model="modelValue.chat.systemPromptExtra"
          rows="3"
          placeholder="可选，追加到系统提示词末尾"
          class="settingsStretchTextarea"
        />
      </div>
    </section>

    <section class="aiSection">
      <h3 class="aiSectionTitle">嵌入模型（RAG）</h3>
      <p class="settingsHint">
        向量模型，用于语义搜索和 RAG
        检索；修改「向量维度」并保存后将清空已建索引。
      </p>
      <div class="settingsRow">
        <span class="settingsLabel small">接口地址</span>
        <input
          v-model="modelValue.embedding.baseUrl"
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
            v-model="modelValue.embedding.apiKey"
            class="settingsStretchInput settingsPasswordRow__input"
            :type="showEmbedKey ? 'text' : 'password'"
            autocomplete="off"
          />
          <button
            type="button"
            class="btn iconOnly"
            :title="showEmbedKey ? '隐藏' : '显示'"
            @click="showEmbedKey = !showEmbedKey"
          >
            <span
              class="iconSvg"
              v-html="showEmbedKey ? icons.view : icons.viewOff"
            />
          </button>
        </div>
      </div>
      <div class="settingsRow">
        <span class="settingsLabel small">模型</span>
        <div class="aiModelToolbar">
          <AppCustomSelect
            class="aiModelSelect"
            :model-value="modelValue.embedding.model"
            :display-label="embedModelDisplayLabel"
            :fixed-top-items="selectListsEmpty"
            :scroll-items="embedModelScrollItems"
            :fixed-bottom-items="selectListsEmpty"
            :scroll-max-height="260"
            ariaLabel="嵌入模型"
            @panel-open-change="onEmbedModelPanelOpenChange"
            @update:model-value="modelValue.embedding.model = $event"
          />
          <button
            type="button"
            class="btn"
            :disabled="embedModelsLoading"
            @click="refreshEmbedModels"
          >
            <span
              class="iconSvg"
              :class="{ 'iconSvg--spinning': embedModelsLoading }"
              v-html="icons.refresh"
            />
            拉取模型
          </button>
          <button
            type="button"
            class="btn"
            :class="{
              success: embedTestPhase === 'ok',
              danger: embedTestPhase === 'fail',
            }"
            :disabled="embedTestPhase === 'pending'"
            @click="testEmbedding"
          >
            <span
              class="iconSvg"
              :class="{ 'iconSvg--spinning': embedTestPhase === 'pending' }"
              v-html="embedTestIconHtml"
            />
            测试连接
          </button>
        </div>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel"
            >向量维度（{{ modelValue.embedding.dimension }}）</span
          >
          <div class="embedDimRow">
            <NumericInput
              v-model="modelValue.embedding.dimension"
              :min="64"
              :max="8192"
              integer
              class="numCompact"
            />
            <button
              type="button"
              class="btn"
              :disabled="embedDimProbing"
              title="向服务端请求一次最短嵌入，按返回向量长度填入"
              @click="probeEmbedDimension"
            >
              <span
                class="iconSvg"
                :class="{ 'iconSvg--spinning': embedDimProbing }"
                v-html="icons.refresh"
              />
              自动检测
            </button>
          </div>
        </div>
        <p class="settingsHint">
          多数 OpenAI
          兼容接口会返回完整向量，可通过「自动检测」填入维度；若服务端支持可变维度（如部分
          OpenAI 模型），以实际返回为准。
        </p>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel"
            >检索 Top-K（{{ modelValue.ragTopK }}）</span
          >
          <NumericInput
            v-model="modelValue.ragTopK"
            :min="1"
            :max="20"
            integer
            class="numCompact"
          />
        </div>
      </div>
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
  /* border: 1px solid var(--border); */
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
}

.settingsLabel.small {
  font-size: 12px;
  color: var(--muted);
}

.settingsHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
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
  width: 18px;
  height: 18px;
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
  gap: 6px;
}

.aiModelToolbar .btn.success .iconSvg :deep(path),
.aiModelToolbar .btn.danger .iconSvg :deep(path) {
  fill: currentColor;
}

.aiModelSelect {
  flex: 1 1 160px;
  min-width: 0;
}

.numCompact {
  width: 120px;
}

.embedDimRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.embedDimRow .btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
