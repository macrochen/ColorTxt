/** 侧栏内置 tab；扩展视图为 `ext:<name>:<viewId>` */
export type ReaderCoreSidebarTab =
  | "files"
  | "chapters"
  | "bookmarks"
  | "highlights"
  | "aiAssistant"
  | "search"
  | "extensions";

export type ReaderSidebarTab = ReaderCoreSidebarTab | (string & {});

export function isExtensionViewTab(tab: string): boolean {
  return tab.startsWith("ext:");
}

export function extensionTabKey(extId: string, viewId: string): string {
  return `ext:${extId}:${viewId}`;
}

export function parseExtensionTabKey(
  tab: string,
): { extId: string; viewId: string } | null {
  if (!tab.startsWith("ext:")) return null;
  const rest = tab.slice("ext:".length);
  const i = rest.indexOf(":");
  if (i <= 0 || i >= rest.length - 1) return null;
  return { extId: rest.slice(0, i), viewId: rest.slice(i + 1) };
}
