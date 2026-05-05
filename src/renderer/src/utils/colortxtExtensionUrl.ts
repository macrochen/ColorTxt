/**
 * 构建扩展资源 URL（主进程 `colortxt-extension` 协议）。
 * 使用「空 host + pathname」承载扩展 id，避免 id 中含 `.` 时被当作域名解析导致 img/iframe 加载失败。
 */
export function colortxtExtensionUrl(extId: string, relPath: string): string {
  const norm = relPath.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  const segs = norm.split("/").filter(Boolean).map((s) => encodeURIComponent(s));
  const suffix = segs.length ? `/${segs.join("/")}` : "";
  return `colortxt-extension:///${encodeURIComponent(extId)}${suffix}`;
}
