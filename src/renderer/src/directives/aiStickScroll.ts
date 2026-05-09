import type { Directive } from "vue";

const FOLD_STICK_SCROLL_PX = 36;

type StickScrollEl = HTMLElement & { __aiPinBottom?: boolean };

/** 折叠详情内 pre：接近底部时打开自动贴底，用户上滚后解除 */
export const vAiStickScroll: Directive<HTMLElement> = {
  mounted(el) {
    const root = el as StickScrollEl;
    root.__aiPinBottom = true;
    const onScroll = () => {
      const dist = root.scrollHeight - root.scrollTop - root.clientHeight;
      root.__aiPinBottom = dist < FOLD_STICK_SCROLL_PX;
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    (root as StickScrollEl & { __aiStickOff?: () => void }).__aiStickOff = () =>
      root.removeEventListener("scroll", onScroll);
  },
  updated(el) {
    const root = el as StickScrollEl;
    if (root.__aiPinBottom) root.scrollTop = root.scrollHeight;
  },
  unmounted(el) {
    (el as StickScrollEl & { __aiStickOff?: () => void }).__aiStickOff?.();
  },
};
