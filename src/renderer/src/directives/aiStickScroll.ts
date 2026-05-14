import type { Directive } from "vue";

const FOLD_STICK_SCROLL_PX = 36;

type StickScrollEl = HTMLElement & {
  __aiPinBottom?: boolean;
  /** 程序化贴底触发的 scroll 不更新「是否在底部」判断 */
  __aiStickIgnoreScroll?: boolean;
  __aiStickOff?: () => void;
};

function scheduleStickToBottom(el: HTMLElement) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const root = el as StickScrollEl;
      if (!root.__aiPinBottom) return;
      root.__aiStickIgnoreScroll = true;
      root.scrollTop = root.scrollHeight;
      requestAnimationFrame(() => {
        root.__aiStickIgnoreScroll = false;
      });
    });
  });
}

/** 折叠详情内 pre：接近底部时打开自动贴底，用户上滚后解除 */
export const vAiStickScroll: Directive<HTMLElement> = {
  mounted(el) {
    const root = el as StickScrollEl;
    root.__aiPinBottom = true;

    const onScroll = () => {
      if (root.__aiStickIgnoreScroll) return;
      // details 收起或侧栏 v-show 隐藏时 clientHeight 为 0，勿误判为「已离开底部」
      if (root.clientHeight < 1) return;
      const dist = root.scrollHeight - root.scrollTop - root.clientHeight;
      root.__aiPinBottom = dist < FOLD_STICK_SCROLL_PX;
    };
    root.addEventListener("scroll", onScroll, { passive: true });

    const details = root.closest("details");
    const onDetailsToggle = () => {
      if (details?.open && root.__aiPinBottom) scheduleStickToBottom(root);
    };
    details?.addEventListener("toggle", onDetailsToggle);

    /** 侧栏 tab v-show 切回后 Vue 未必触发子节点 updated；尺寸从 0 恢复时再贴底 */
    const ro = new ResizeObserver(() => {
      if (root.__aiPinBottom && root.clientHeight > 0) scheduleStickToBottom(root);
    });
    ro.observe(root);

    /** 从不可见区域回到可见（含活动 tab 切换）时再尝试贴底 */
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (
            entry.target === root &&
            entry.isIntersecting &&
            root.__aiPinBottom &&
            root.clientHeight > 0
          ) {
            scheduleStickToBottom(root);
          }
        }
      },
      { threshold: [0, 0.01, 1] },
    );
    io.observe(root);

    root.__aiStickOff = () => {
      root.removeEventListener("scroll", onScroll);
      details?.removeEventListener("toggle", onDetailsToggle);
      ro.disconnect();
      io.disconnect();
    };

    scheduleStickToBottom(root);
  },
  updated(el) {
    const root = el as StickScrollEl;
    if (root.__aiPinBottom) scheduleStickToBottom(root);
  },
  unmounted(el) {
    (el as StickScrollEl).__aiStickOff?.();
  },
};
