<script setup lang="ts">
import AiAssistantDetailsFold from "./AiAssistantDetailsFold.vue";
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
              <AiAssistantDetailsFold
                v-if="row.rowKind === 'think'"
                v-model:open="row.think.open"
                variant="think"
                :live="!row.think.sealed"
                :show-content="Boolean(row.think.text.trim()) || !row.think.sealed"
                @content-pointerdown="onAiFoldContentPointerDown"
              >
                <template #icon>
                  <span
                    v-if="!row.think.sealed"
                    class="svg aiThinkingPulse"
                    v-html="icons.thinkingPulse"
                  />
                  <span
                    v-else
                    class="svg aiFoldSummary__icon"
                    v-html="icons.brain"
                  />
                </template>
                <template #title>
                  <template v-if="!row.think.sealed">正在思考…</template>
                  <template v-else>思考过程</template>
                </template>
                <pre
                  v-ai-stick-scroll
                  class="aiFoldBody aiFoldBody--thinking"
                  >{{ row.think.text }}</pre
                >
              </AiAssistantDetailsFold>
              <AiAssistantDetailsFold
                v-else
                v-model:open="row.tool.open"
                variant="tool"
                @content-pointerdown="onAiFoldContentPointerDown"
              >
                <template #icon>
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
                </template>
                <template #title>{{
                  toolDisplayLabel(row.tool.name, skillToolLabels)
                }}</template>
                <AiToolFoldBody :tool="row.tool" />
              </AiAssistantDetailsFold>
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
            <div v-if="m.aborted" class="aiNoticeBanner" role="status">
              <span
                class="aiNoticeBanner__icon"
                aria-hidden="true"
                v-html="icons.warning"
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
</style>
