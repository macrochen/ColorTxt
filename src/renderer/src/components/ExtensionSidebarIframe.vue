<script setup lang="ts">
import { inject, onBeforeUnmount, ref, watch } from "vue";
import {
  extensionHostBridgeKey,
} from "../composables/useExtensionHostBridge";

const props = defineProps<{
  src: string;
  extId: string;
  viewId: string;
  reloadNonce: number;
}>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
const bridge = inject(extensionHostBridgeKey, null);

let unregister: (() => void) | null = null;

function cleanup() {
  unregister?.();
  unregister = null;
}

function onIframeLoad() {
  cleanup();
  const el = iframeRef.value;
  if (!el || !bridge) return;
  unregister = bridge.registerExtensionIframe(el, {
    extId: props.extId,
    viewId: props.viewId,
  });
}

watch(
  () => props.reloadNonce,
  () => {
    cleanup();
  },
);

onBeforeUnmount(() => cleanup());
</script>

<template>
  <iframe
    :key="`${extId}-${viewId}-${reloadNonce}`"
    ref="iframeRef"
    class="extensionSidebarIframe"
    :src="src"
    title=""
    sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
    referrerpolicy="no-referrer"
    @load="onIframeLoad"
  />
</template>

<style scoped>
.extensionSidebarIframe {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
}
</style>
