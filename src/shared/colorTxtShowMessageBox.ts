/**
 * 经 IPC 传入主进程的 `dialog.showMessageBox` 选项。
 * 与 Electron `MessageBoxOptions` 对齐的可序列化子集（不含 `signal`；`icon` 仅支持字符串路径）。
 */
export type ColorTxtShowMessageBoxOptions = {
  message: string;
  type?: "none" | "info" | "error" | "question" | "warning";
  buttons?: string[];
  defaultId?: number;
  title?: string;
  detail?: string;
  checkboxLabel?: string;
  checkboxChecked?: boolean;
  icon?: string;
  cancelId?: number;
  noLink?: boolean;
  normalizeAccessKeys?: boolean;
  /** `@platform darwin` */
  textWidth?: number;
};

export type ColorTxtShowMessageBoxResult = {
  response: number;
  checkboxChecked: boolean;
};
