<script setup lang="ts">
import AiMarkdown from "./AiMarkdown.vue";
import AiToolFoldBody from "./AiToolFoldBody.vue";
import { vAiStickScroll } from "../directives/aiStickScroll";
import {
  expandAssistantSegRows,
  toolDisplayLabel,
} from "../aiAssistant/aiAssistantSegments";
import type { UiMsg } from "../aiAssistant/aiAssistantTypes";
import { assistantAnswerMdSource } from "../aiAssistant/aiAssistantPlainText";
import { icons } from "../icons";

defineProps<{
  messages: UiMsg[];
  /** OpenAI 工具名 → 技能展示名（含内置与自定义） */
  skillToolLabels?: Record<string, string>;
}>();

const emit = defineEmits<{
  chapterClick: [chapterIndexZeroBased: number];
}>();

function onChClick(chIdx: number) {
  emit("chapterClick", chIdx);
}

function onAiFoldContentPointerDown(ev: PointerEvent) {
  const t = ev.currentTarget;
  if (t instanceof HTMLElement) t.focus({ preventScroll: true });
}
</script>

<template>
  <!-- 与父级 .aiList 一致：原先每条消息是 .aiList 的直接子节点才吃到 gap；抽成子组件后须在内部自己做纵向间距 -->
  <div class="aiChatMessagesStack">
    <template v-for="m in messages" :key="m.id">
      <div v-if="m.role === 'indexBanner'" class="aiMsg aiMsg--bot">
        <div class="aiMsgInner">
          <div
            v-if="m.phase !== 'error'"
            class="aiIndexBanner"
            role="status"
            aria-live="polite"
          >
            <template v-if="m.phase === 'chunking'">正在分块…</template>
            <template v-else-if="m.phase === 'embedding'">
              正在向量化 {{ m.embedCurrent }} / {{ m.embedTotal }} …
            </template>
            <template v-else>正在写入索引…</template>
          </div>
          <div v-else class="aiIndexErr" role="alert">
            索引失败：{{ m.errorText }}
          </div>
        </div>
      </div>
      <div
        v-else
        class="aiMsg"
        :class="m.role === 'user' ? 'aiMsg--user' : 'aiMsg--bot'"
      >
        <div class="aiMsgInner">
          <template v-if="m.role === 'assistant'">
            <template
              v-for="row in expandAssistantSegRows(m)"
              :key="
                row.rowKind === 'think'
                  ? `th-${row.segIdx}`
                  : `tl-${row.tool.toolCallId}-${row.segIdx}`
              "
            >
              <details
                v-if="row.rowKind === 'think'"
                class="aiFold"
                :class="{ 'aiFold--liveThink': !row.think.sealed }"
                :open="row.think.open"
                @toggle="
                  row.think.open = ($event.target as HTMLDetailsElement).open
                "
              >
                <summary class="aiFoldSummary">
                  <span class="aiFoldSummaryLead">
                    <template v-if="!row.think.sealed">
                      <span class="aiFoldLeadIcon" aria-hidden="true">
                        <span
                          class="svg aiThinkingPulse"
                          v-html="icons.thinkingPulse"
                        />
                      </span>
                      <span class="aiFoldTitle">正在思考…</span>
                    </template>
                    <template v-else>
                      <span class="aiFoldLeadIcon" aria-hidden="true">
                        <span
                          class="svg aiFoldSummary__icon"
                          v-html="icons.brain"
                        />
                      </span>
                      <span class="aiFoldTitle">思考过程</span>
                    </template>
                  </span>
                  <span
                    class="svg aiFoldChevron"
                    aria-hidden="true"
                    v-html="icons.foldChevron"
                  />
                </summary>
                <div
                  v-if="row.think.text.trim()"
                  class="aiFoldContent"
                  tabindex="-1"
                  @pointerdown="onAiFoldContentPointerDown"
                >
                  <pre
                    v-ai-stick-scroll
                    class="aiFoldBody aiFoldBody--thinking"
                    >{{ row.think.text }}</pre
                  >
                </div>
              </details>
              <details
                v-else
                class="aiFold aiFold--tool"
                :open="row.tool.open"
                @toggle="
                  row.tool.open = ($event.target as HTMLDetailsElement).open
                "
              >
                <summary class="aiFoldSummary">
                  <span class="aiFoldSummaryLead aiFoldSummaryLead--tool">
                    <span class="aiFoldLeadIcon" aria-hidden="true">
                      <span
                        v-if="row.tool.status === 'running'"
                        class="svg aiThinkingPulse"
                        v-html="icons.thinkingPulse"
                      />
                      <span
                        v-else-if="row.tool.status === 'done'"
                        class="svg aiToolOutcomeIcon"
                        v-html="icons.success"
                      />
                      <span
                        v-else
                        class="svg aiToolOutcomeIcon aiToolOutcomeIcon--fail"
                        v-html="icons.fail"
                      />
                    </span>
                    <span class="aiFoldTitle">{{
                      toolDisplayLabel(row.tool.name, skillToolLabels)
                    }}</span>
                  </span>
                  <span
                    class="svg aiFoldChevron"
                    aria-hidden="true"
                    v-html="icons.foldChevron"
                  />
                </summary>
                <div
                  class="aiFoldContent"
                  tabindex="-1"
                  @pointerdown="onAiFoldContentPointerDown"
                >
                  <AiToolFoldBody :tool="row.tool" />
                </div>
              </details>
            </template>
            <AiMarkdown
              v-if="assistantAnswerMdSource(m).trim() && !m.error"
              :source="assistantAnswerMdSource(m)"
              @chapter-click="onChClick"
            />
            <div v-if="m.error" class="aiAssistantErr">{{ m.answer }}</div>
            <div
              v-if="m.errorDetail"
              class="aiAssistantErr aiAssistantErr--follow"
            >
              {{ m.errorDetail }}
            </div>
            <div v-if="m.aborted" class="aiUserStoppedBanner" role="status">
              <span
                class="svg aiUserStoppedBanner__icon"
                aria-hidden="true"
                v-html="icons.fail"
              />
              <span>用户取消了生成</span>
            </div>
          </template>
          <div v-else class="aiUserText">{{ m.content }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.aiChatMessagesStack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.svg :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.aiIndexBanner,
.aiIndexErr {
  font-size: 12px;
  padding: 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--fg);
}

.aiIndexErr {
  background: color-mix(in srgb, #f44 15%, transparent);
}

.aiMsg {
  display: flex;
}

.aiMsg--user {
  justify-content: flex-end;
}

.aiMsgInner {
  max-width: 90%;
  position: relative;
  padding: 8px 10px;
  border-radius: 10px;
}

.aiMsg--bot .aiMsgInner {
  max-width: 100%;
  width: 100%;
  box-sizing: border-box;
  padding: 0;
}

.aiMsg--user .aiMsgInner {
  background: var(--panel);
  border: 1px solid var(--border);
}

.aiUserText {
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
}

.aiFold {
  margin: 0 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--fg) 4%, transparent);
  overflow: hidden;
  background: var(--panel);
}

.aiFold--tool:last-of-type {
  margin-bottom: 10px;
}

.aiFold--liveThink {
  border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
}

.aiFoldSummary {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  font-size: 12px;
  color: var(--muted);
  user-select: none;
  width: 100%;
  box-sizing: border-box;
  background: var(--bg);
}

.aiFoldSummary:hover {
  background: var(--icon-btn-bg-hover);
}

.aiFoldSummary::-webkit-details-marker {
  display: none;
}

.aiFoldSummaryLead {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.aiFoldSummaryLead--tool {
  align-items: center;
}

/** 左侧状态图标固定槽，保证思考块 / 工具块图标与标题起点对齐 */
.aiFoldLeadIcon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.aiFoldLeadIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.aiFoldChevron {
  flex-shrink: 0;
  margin-left: auto;
  color: color-mix(in srgb, var(--muted) 85%, var(--fg));
  transition: transform 0.22s ease;
}

.aiFoldChevron :deep(svg) {
  width: 10px;
  height: 10px;
  display: block;
}

.aiFoldChevron :deep(svg path) {
  fill: currentColor;
}

.aiFold[open] > .aiFoldSummary .aiFoldChevron {
  transform: rotate(180deg);
}

.aiFoldSummary__icon :deep(svg path) {
  fill: currentColor;
}

.aiFoldContent {
  border-top: 1px solid var(--border);
  outline: none;
}

.aiFoldContent:focus-visible {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
}

.aiFoldBody {
  margin: 0;
  padding: 10px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: color-mix(in srgb, var(--fg) 88%, var(--muted));
  max-height: 240px;
  overflow-y: auto;
}

.aiFoldBody--thinking {
  max-height: 180px;
}

/** 「正在思考…」/ 工具进行中：icons.thinkingPulse + 缓慢闪烁 */
.aiThinkingPulse {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: color-mix(in srgb, #3b82f6 75%, var(--accent) 25%);
  animation: aiThinkingPulseBreathe 1.25s ease-in-out infinite;
}

@keyframes aiThinkingPulseBreathe {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.92);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.aiToolOutcomeIcon {
  flex-shrink: 0;
  color: color-mix(in srgb, #22c55e 80%, var(--fg));
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.aiToolOutcomeIcon :deep(svg path) {
  fill: currentColor;
}

.aiToolOutcomeIcon--fail {
  color: var(--danger);
}

/** 折叠标题主文案：工具显示名、正在思考… / 思考过程等 */
.aiFoldTitle {
  font-weight: 600;
  color: var(--fg);
  flex-shrink: 0;
  flex: 1;
  min-width: 0;
}

.aiAssistantErr {
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, #c62828 11%, transparent);
  color: color-mix(in srgb, var(--fg) 40%, #b71c1c 60%);
  border: 1px solid color-mix(in srgb, #c62828 22%, transparent);
}

.aiAssistantErr--follow {
  margin-top: 8px;
}

.aiUserStoppedBanner {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 6px;
  border-radius: 8px;
  border: 1px solid var(--warning-border);
  background: var(--warning-bg);
  color: var(--warning);
  font-size: 13px;
  line-height: 1.45;
}

.aiUserStoppedBanner__icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--warning);
}

.aiUserStoppedBanner__icon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.aiUserStoppedBanner__icon :deep(svg path) {
  fill: currentColor;
}
</style>
