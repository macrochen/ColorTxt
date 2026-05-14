<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { AIConfig } from "@shared/aiTypes";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import AppPullFlashButton, { type AppPullFlashDone } from "./AppPullFlashButton.vue";
import NumericInput from "./NumericInput.vue";
import SwitchToggle from "./SwitchToggle.vue";
import { icons } from "../icons";
import { appAlert } from "../services/appDialog";

const modelValue = defineModel<AIConfig>({ required: true });

const selectListsEmpty: CustomSelectItem[] = [];

type AiTestPhase = "idle" | "pending" | "ok" | "fail";

const showEmbedKey = ref(false);
const embedModelsLoading = ref(false);
const embedPullBtnRef = ref<InstanceType<typeof AppPullFlashButton> | null>(null);
const embedTestPhase = ref<AiTestPhase>("idle");
const embedModelOptions = ref<string[]>([]);
type EmbedProbeFlashPhase = "idle" | "loading" | "success" | "fail";
const embedProbeFlashPhase = ref<EmbedProbeFlashPhase>("idle");
let embedProbeFlashTimer: ReturnType<typeof setTimeout> | null = null;

const embedLastResolvedFingerprint = ref<string | null>(null);

const embedEndpointFingerprint = computed(() => {
  const e = modelValue.value.embedding;
  return `${e.baseUrl.trim()}\0${e.apiKey}\0${e.model.trim()}\0${e.dimension}`;
});

watch(embedEndpointFingerprint, (fp) => {
  if (embedTestPhase.value === "pending") return;
  if (embedLastResolvedFingerprint.value === null) return;
  if (fp !== embedLastResolvedFingerprint.value) {
    embedTestPhase.value = "idle";
    embedLastResolvedFingerprint.value = null;
  }
});

const embedModelScrollItems = computed((): CustomSelectItem[] =>
  embedModelOptions.value.map((m) => ({
    kind: "item",
    id: m,
    label: m,
  })),
);

const embedModelDisplayLabel = computed(() =>
  modelValue.value.embedding.model.trim(),
);

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

const embedProbeIconHtml = computed(() => {
  switch (embedProbeFlashPhase.value) {
    case "success":
      return icons.success;
    case "fail":
      return icons.fail;
    default:
      return icons.refresh;
  }
});

async function refreshEmbedModels(opts?: { pullDone?: AppPullFlashDone }) {
  const pullDone = opts?.pullDone;
  embedModelsLoading.value = true;
  let ok = false;
  try {
    const r = await window.colorTxt.ai.modelsList({
      baseUrl: modelValue.value.embedding.baseUrl,
      apiKey: modelValue.value.embedding.apiKey,
    });
    ok = r.ok;
    if (r.ok) {
      embedModelOptions.value = r.models;
      if (!modelValue.value.embedding.model.trim() && r.models.length > 0) {
        modelValue.value.embedding.model = r.models[0];
      }
    } else embedModelOptions.value = [];
  } finally {
    embedModelsLoading.value = false;
    if (pullDone) pullDone(ok);
    else embedPullBtnRef.value?.clearStaleFailOnSilentSuccess(ok);
  }
}

function onEmbedModelPanelOpenChange(isOpen: boolean) {
  if (!isOpen || embedModelsLoading.value) return;
  if (embedModelOptions.value.length > 0) return;
  void refreshEmbedModels();
}

async function probeEmbedDimension(opts?: { auto?: boolean }) {
  const auto = opts?.auto ?? false;
  if (embedProbeFlashPhase.value === "loading") return;
  const baseUrl = modelValue.value.embedding.baseUrl.trim();
  const model = modelValue.value.embedding.model.trim();
  if (!baseUrl || !model) {
    if (!auto) await appAlert("请先填写 Embedding Base URL 与模型。");
    return;
  }
  if (embedProbeFlashTimer != null) {
    clearTimeout(embedProbeFlashTimer);
    embedProbeFlashTimer = null;
  }
  embedProbeFlashPhase.value = "loading";
  let ok = false;
  try {
    const r = await window.colorTxt.ai.embeddingProbeDimension({
      baseUrl: modelValue.value.embedding.baseUrl,
      apiKey: modelValue.value.embedding.apiKey,
      model: modelValue.value.embedding.model,
    });
    if (!r.ok) {
      if (!auto) await appAlert(r.error);
    } else {
      modelValue.value.embedding.dimension = r.dimension;
      ok = true;
    }
  } catch (e) {
    if (!auto) {
      await appAlert(e instanceof Error ? e.message : String(e));
    }
  } finally {
    if (ok) {
      embedProbeFlashPhase.value = "success";
      embedProbeFlashTimer = setTimeout(() => {
        embedProbeFlashPhase.value = "idle";
        embedProbeFlashTimer = null;
      }, 1000);
    } else {
      embedProbeFlashPhase.value = "fail";
    }
  }
}

watch(
  () => ({
    enabled: modelValue.value.embeddingEnabled,
    model: modelValue.value.embedding.model,
  }),
  (cur, prev) => {
    if (!cur.enabled) return;
    if (!prev) return;
    if (cur.model === prev.model) return;
    void probeEmbedDimension({ auto: true });
  },
);

onBeforeUnmount(() => {
  if (embedProbeFlashTimer != null) {
    clearTimeout(embedProbeFlashTimer);
    embedProbeFlashTimer = null;
  }
});

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
      await appAlert(r.error);
      embedTestPhase.value = "fail";
      embedLastResolvedFingerprint.value = fpWhenStarted;
    }
  } catch (e) {
    if (embedEndpointFingerprint.value !== fpWhenStarted) {
      embedTestPhase.value = "idle";
      embedLastResolvedFingerprint.value = null;
      return;
    }
    await appAlert(e instanceof Error ? e.message : String(e));
    embedTestPhase.value = "fail";
    embedLastResolvedFingerprint.value = fpWhenStarted;
  }
}
</script>

<template>
  <div class="settingsBody">
    <section class="aiSection aiSection--compact">
      <div class="aiMasterToggleRow">
        <span class="settingsLabel aiMasterToggleLabel">启用向量模型</span>
        <SwitchToggle
          v-model="modelValue.embeddingEnabled"
          aria-label="启用向量模型"
        />
      </div>
      <p class="aiMasterHint">
        启用后，可建立书籍语义索引，供「AI 阅读助手」与「角色卡」检索与引用。
      </p>
    </section>
    <template v-if="modelValue.embeddingEnabled">
      <section class="aiSection">
        <h3 class="aiSectionTitle">嵌入模型（RAG）</h3>
        <div class="settingsRow">
          <span class="settingsLabel">接口地址</span>
          <input
            v-model="modelValue.embedding.baseUrl"
            type="text"
            autocomplete="off"
            placeholder="http://127.0.0.1:1234/v1"
            class="settingsStretchInput"
          />
        </div>
        <div class="settingsRow">
          <span class="settingsLabel">API 密钥</span>
          <div class="settingsPasswordRow">
            <input
              v-model="modelValue.embedding.apiKey"
              class="settingsStretchInput settingsPasswordRow__input"
              :type="showEmbedKey ? 'text' : 'password'"
              autocomplete="off"
              spellcheck="false"
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
          <span class="settingsLabel">模型</span>
          <div class="aiModelToolbar">
            <AppCustomSelect
              class="aiModelSelect"
              :model-value="modelValue.embedding.model"
              :display-label="embedModelDisplayLabel"
              placeholder="选择嵌入模型…"
              :fixed-top-items="selectListsEmpty"
              :scroll-items="embedModelScrollItems"
              :fixed-bottom-items="selectListsEmpty"
              :scroll-max-height="260"
              ariaLabel="嵌入模型"
              @panel-open-change="onEmbedModelPanelOpenChange"
              @update:model-value="modelValue.embedding.model = $event"
            />
            <AppPullFlashButton
              ref="embedPullBtnRef"
              label="拉取模型"
              :busy="embedModelsLoading"
              @pull="(done) => void refreshEmbedModels({ pullDone: done })"
            />
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
          <p class="aiMasterHint">
            建议使用 <code>BGE Small ZH v1.5</code
            ><code>Multilingual E5 Small</code> 等支持 <b>中文</b> 的嵌入模型。
          </p>
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
                :class="{
                  success: embedProbeFlashPhase === 'success',
                  danger: embedProbeFlashPhase === 'fail',
                }"
                :disabled="embedProbeFlashPhase === 'loading'"
                title="向服务端请求一次最短嵌入，按返回向量长度填入"
                @click="probeEmbedDimension()"
              >
                <span
                  class="iconSvg"
                  :class="{
                    'iconSvg--spinning': embedProbeFlashPhase === 'loading',
                  }"
                  v-html="embedProbeIconHtml"
                />
                自动检测
              </button>
            </div>
          </div>
          <p class="settingsHint">
            多数 OpenAI 兼容接口会返回完整向量，可通过「自动检测」填入维度。
          </p>
          <p class="settingsHint">
            若服务端支持可变维度（如部分 OpenAI 模型），以实际返回为准。
          </p>
          <p class="aiMasterHint">修改「向量维度」将清空已建索引。</p>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span
              class="settingsLabel"
              title="阅读助手 Agent 中 ragSearch 工具在未指定 topK 时的默认返回条数上限。"
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
    </template>
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

.aiSection--compact {
  gap: 12px;
}

.aiMasterToggleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}

.aiMasterToggleLabel {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}

.aiMasterHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.aiMasterHint code {
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 4px;
  background: var(--panel-elevated, rgba(127, 127, 127, 0.12));
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

.settingsHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.settingsStretchInput {
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
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
  animation: vecSettingsIconSpin 0.65s linear infinite;
}

@keyframes vecSettingsIconSpin {
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
</style>
