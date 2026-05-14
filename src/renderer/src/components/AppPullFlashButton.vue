<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { icons } from "../icons";

/** `abort`：未发起请求等场景，按钮恢复为 idle，不闪成功/失败 */
export type AppPullFlashDoneArg = boolean | "abort";

export type AppPullFlashDone = (result: AppPullFlashDoneArg) => void;

const props = withDefaults(
  defineProps<{
    label: string;
    /** 与请求并行的外部 loading（如列表拉取中） */
    busy?: boolean;
    ariaLabel?: string;
  }>(),
  { busy: false, ariaLabel: undefined },
);

const emit = defineEmits<{
  pull: [done: AppPullFlashDone];
}>();

type Phase = "idle" | "loading" | "success" | "fail";
const phase = ref<Phase>("idle");
let successTimer: ReturnType<typeof setTimeout> | null = null;

function clearSuccessTimer() {
  if (successTimer != null) {
    clearTimeout(successTimer);
    successTimer = null;
  }
}

const iconHtml = computed(() => {
  switch (phase.value) {
    case "success":
      return icons.success;
    case "fail":
      return icons.fail;
    default:
      return icons.refresh;
  }
});

const disabled = computed(
  () => phase.value === "loading" || props.busy === true,
);

const iconSpinning = computed(
  () => phase.value === "loading" || props.busy === true,
);

function finish(result: AppPullFlashDoneArg) {
  if (result === "abort") {
    clearSuccessTimer();
    phase.value = "idle";
    return;
  }
  if (result) {
    phase.value = "success";
    clearSuccessTimer();
    successTimer = setTimeout(() => {
      phase.value = "idle";
      successTimer = null;
    }, 1000);
  } else {
    clearSuccessTimer();
    phase.value = "fail";
  }
}

function onClick() {
  if (disabled.value) return;
  clearSuccessTimer();
  phase.value = "loading";
  emit("pull", finish);
}

/** 静默拉取成功后，若按钮仍停在失败态则清除（与设置页原逻辑一致） */
function clearStaleFailOnSilentSuccess(ok: boolean) {
  if (ok && phase.value === "fail") phase.value = "idle";
}

function reset() {
  clearSuccessTimer();
  phase.value = "idle";
}

onBeforeUnmount(() => {
  clearSuccessTimer();
});

defineExpose({
  clearStaleFailOnSilentSuccess,
  reset,
});
</script>

<template>
  <button
    type="button"
    class="btn appPullFlashBtn"
    :class="{
      success: phase === 'success',
      danger: phase === 'fail',
    }"
    :disabled="disabled"
    :aria-label="ariaLabel ?? label"
    @click="onClick"
  >
    <span
      class="iconSvg appPullFlashBtn__icon"
      :class="{ 'iconSvg--spinning': iconSpinning }"
      v-html="iconHtml"
    />
    {{ label }}
  </button>
</template>

<style scoped>
.appPullFlashBtn__icon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.appPullFlashBtn__icon :deep(svg path) {
  fill: currentColor;
}

.appPullFlashBtn__icon.iconSvg--spinning :deep(svg) {
  animation: appPullFlashBtnIconSpin 0.65s linear infinite;
}

@keyframes appPullFlashBtnIconSpin {
  to {
    transform: rotate(360deg);
  }
}
</style>
