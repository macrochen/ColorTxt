import { onBeforeUnmount, onMounted } from "vue";

let listenerRefCount = 0;
let captureHandler: ((ev: KeyboardEvent) => void) | null = null;

function foldContentFromNode(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const start =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  const c = start?.closest(".aiFoldContent");
  return c instanceof HTMLElement ? c : null;
}

/** 工具折叠内「请求 / 结果」各一块 `<pre>`：Ctrl+A 仅全选该块，而非整块 `.aiFoldContent` */
function toolFoldPreFromNode(node: Node | null): HTMLPreElement | null {
  if (!node) return null;
  const start =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  const pre = start?.closest("pre.aiFoldBody");
  if (!(pre instanceof HTMLPreElement)) return null;
  return pre.closest(".aiToolFoldBodyRoot") ? pre : null;
}

function findAiFoldSelectAllTarget(): HTMLElement | null {
  const sel = window.getSelection();
  if (sel?.rangeCount) {
    const toolPre = toolFoldPreFromNode(sel.anchorNode);
    if (toolPre) return toolPre;
  }

  const ae = document.activeElement;
  if (ae instanceof HTMLElement) {
    const toolPre = toolFoldPreFromNode(ae);
    if (toolPre) return toolPre;
    const fold = foldContentFromNode(ae);
    if (fold) return fold;
  }

  if (sel?.rangeCount) {
    return foldContentFromNode(sel.anchorNode);
  }
  return null;
}

function onWindowCaptureAiFoldSelectAll(ev: KeyboardEvent) {
  if (ev.key !== "a" && ev.key !== "A") return;
  if (!ev.ctrlKey && !ev.metaKey) return;
  if (ev.altKey) return;

  const ae = document.activeElement;
  if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) {
    return;
  }

  const content = findAiFoldSelectAllTarget();
  if (!content) return;

  ev.preventDefault();
  ev.stopImmediatePropagation();
  const range = document.createRange();
  range.selectNodeContents(content);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}
function registerAiFoldContentSelectAllListener(): void {
  listenerRefCount += 1;
  if (listenerRefCount === 1) {
    captureHandler = onWindowCaptureAiFoldSelectAll;
    window.addEventListener("keydown", captureHandler, true);
  }
}

function unregisterAiFoldContentSelectAllListener(): void {
  listenerRefCount -= 1;
  if (listenerRefCount <= 0) {
    listenerRefCount = 0;
    if (captureHandler) {
      window.removeEventListener("keydown", captureHandler, true);
      captureHandler = null;
    }
  }
}

/** 由 `AiAssistantDetailsFold` 引用计数挂载：焦点或选区在折叠正文内时 Ctrl/Cmd+A 仅全选该内容区 */
export function useAiFoldContentSelectAll(): void {
  onMounted(registerAiFoldContentSelectAllListener);
  onBeforeUnmount(unregisterAiFoldContentSelectAllListener);
}
