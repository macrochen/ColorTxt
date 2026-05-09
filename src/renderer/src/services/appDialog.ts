import { nextTick, reactive } from "vue";

export type AppDialogKind = "alert" | "confirm" | "prompt";

export const appDialogModel = reactive({
  open: false,
  kind: "alert" as AppDialogKind,
  title: "提示",
  message: "",
  /** prompt：与输入框双向绑定（打开时由队列项初始化） */
  promptValue: "",
  promptPlaceholder: "",
});

type QAlert = {
  kind: "alert";
  title: string;
  message: string;
  resolve: () => void;
};

type QConfirm = {
  kind: "confirm";
  title: string;
  message: string;
  resolve: (ok: boolean) => void;
};

type QPrompt = {
  kind: "prompt";
  title: string;
  message: string;
  defaultValue: string;
  placeholder: string;
  resolve: (value: string | null) => void;
};

type Queued = QAlert | QConfirm | QPrompt;

const queue: Queued[] = [];

function applyQueuedToModel(item: Queued) {
  appDialogModel.kind = item.kind;
  appDialogModel.title = item.title;
  appDialogModel.message = item.message;
  if (item.kind === "prompt") {
    appDialogModel.promptValue = item.defaultValue;
    appDialogModel.promptPlaceholder = item.placeholder;
  }
}

function pump() {
  const next = queue[0];
  if (!next) {
    appDialogModel.open = false;
    return;
  }
  applyQueuedToModel(next);
  appDialogModel.open = true;
}

function pumpNext() {
  const next = queue[0];
  if (!next) {
    appDialogModel.open = false;
    return;
  }
  applyQueuedToModel(next);
}

function enqueue(item: Queued) {
  queue.push(item);
  if (!appDialogModel.open) {
    void nextTick(() => {
      if (appDialogModel.open) return;
      pump();
    });
  }
}

/** 主按钮：alert / confirm 确定 / prompt 确定（允许空字符串） */
export function appDialogPrimary() {
  const cur = queue[0];
  if (!cur) return;
  queue.shift();
  const promptSnapshot =
    cur.kind === "prompt" ? appDialogModel.promptValue : "";
  if (cur.kind === "alert") cur.resolve();
  else if (cur.kind === "confirm") cur.resolve(true);
  else cur.resolve(promptSnapshot);
  pumpNext();
}

/** 次按钮：confirm 取消、prompt 取消（alert 无） */
export function appDialogSecondary() {
  const cur = queue[0];
  if (!cur || cur.kind === "alert") return;
  queue.shift();
  if (cur.kind === "confirm") cur.resolve(false);
  else cur.resolve(null);
  pumpNext();
}

/**
 * 蒙层 / Esc / 右上角关闭：alert 视为确定；confirm / prompt 视为取消。
 */
export function appDialogUserDismiss() {
  const cur = queue[0];
  if (!cur) {
    appDialogModel.open = false;
    return;
  }
  queue.shift();
  if (cur.kind === "alert") cur.resolve();
  else if (cur.kind === "confirm") cur.resolve(false);
  else cur.resolve(null);
  pumpNext();
}

export function appAlert(message: string, title = "提示"): Promise<void> {
  return new Promise((resolve) => {
    enqueue({ kind: "alert", title, message, resolve });
  });
}

export function appConfirm(message: string, title = "确认"): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({ kind: "confirm", title, message, resolve });
  });
}

export type AppPromptOptions = {
  title?: string;
  defaultValue?: string;
  placeholder?: string;
};

/** 确定返回输入文本（可为空串），取消 / 蒙层 / Esc 返回 `null` */
export function appPrompt(
  message: string,
  options?: AppPromptOptions,
): Promise<string | null> {
  const title = options?.title ?? "输入";
  const defaultValue = options?.defaultValue ?? "";
  const placeholder = options?.placeholder ?? "";
  return new Promise((resolve) => {
    enqueue({
      kind: "prompt",
      title,
      message,
      defaultValue,
      placeholder,
      resolve,
    });
  });
}
