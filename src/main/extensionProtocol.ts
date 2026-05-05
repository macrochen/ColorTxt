import { protocol } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildRootIndexFromRows,
  listAllExtensionRows,
  resolveExtensionFilePath,
} from "./extensionService";

let extensionRootIndex = new Map<string, string>();

/** 阅读器主题（与 `theme:set` 一致）；扩展 HTML 不再使用 URL 查询参数 */
let readerThemeIdForExtensionHtml = "vs";

export function setReaderThemeIdForExtensionHtml(themeId: string): void {
  const t = themeId.trim();
  readerThemeIdForExtensionHtml =
    t === "vs" || t === "vs-dark" ? t : "vs";
}

export function setExtensionRootIndexForProtocol(
  index: Map<string, string>,
): void {
  extensionRootIndex = index;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

/** 是否在 `<html>` 上追加 `dark`（与常见工具类 / Tailwind 习惯一致） */
function hostThemeImpliesDark(themeId: string): boolean {
  const t = themeId.trim().toLowerCase();
  if (!t || t === "vs") return false;
  if (t === "vs-dark") return true;
  if (t.endsWith("-dark")) return true;
  if (t === "hc-black") return true;
  return false;
}

const EXT_HOST_THEME_CLASS_MSG = "colortxt/ext:host-theme-class";

function setHtmlDarkClass(htmlAttrs: string, dark: boolean): string {
  const classMatch = htmlAttrs.match(/\sclass\s*=\s*(["'])([\s\S]*?)\1/i);
  if (classMatch) {
    const q = classMatch[1];
    const existing = classMatch[2].trim();
    const tokens = new Set(existing.split(/\s+/).filter(Boolean));
    if (dark) tokens.add("dark");
    else tokens.delete("dark");
    const merged = [...tokens].join(" ");
    const replacement = merged ? ` class=${q}${merged}${q}` : "";
    return htmlAttrs.replace(classMatch[0], replacement);
  }
  return dark ? `${htmlAttrs} class="dark"` : htmlAttrs;
}

/**
 * 为扩展 HTML 注入：
 * 1) 初始 `html.dark`
 * 2) 监听宿主消息实时切换 class（不刷新 iframe）
 */
function injectHtmlDarkClassBridge(html: string, themeRaw: string): string {
  const dark = hostThemeImpliesDark(themeRaw.trim());
  const withHtmlClass = html.replace(/<html\b([^>]*)>/i, (_full, attrs: string) => {
    const nextAttrs = setHtmlDarkClass(attrs, dark);
    return `<html${nextAttrs}>`;
  });

  const bridgeScript = [
    "<script>",
    "(function(){",
    `  var TYPE = ${JSON.stringify(EXT_HOST_THEME_CLASS_MSG)};`,
    "  function applyDark(v){",
    "    var root = document && document.documentElement;",
    "    if (!root) return;",
    "    root.classList.toggle('dark', !!v);",
    "  }",
    "  window.addEventListener('message', function(ev){",
    "    var d = ev && ev.data;",
    "    if (!d || d.type !== TYPE) return;",
    "    applyDark(!!d.dark);",
    "  });",
    "})();",
    "</script>",
  ].join('');

  if (/<\/head>/i.test(withHtmlClass)) {
    return withHtmlClass.replace(/<\/head>/i, `${bridgeScript}</head>`);
  }
  if (/<body\b/i.test(withHtmlClass)) {
    return withHtmlClass.replace(/<body\b/i, `${bridgeScript}<body`);
  }
  return `${bridgeScript}${withHtmlClass}`;
}

export async function refreshExtensionProtocolRoots(): Promise<void> {
  const rows = await listAllExtensionRows();
  setExtensionRootIndexForProtocol(buildRootIndexFromRows(rows));
}

export function registerColortxtExtensionProtocol(): void {
  protocol.handle("colortxt-extension", async (request) => {
    let u: URL;
    try {
      u = new URL(request.url);
    } catch {
      return new Response(null, { status: 400 });
    }
    /** 带点号的扩展 id 不宜放在 URL hostname（Chromium/Electron 下 img/iframe 易加载失败） */
    let extId: string;
    let pathnameRest: string;
    if (u.hostname) {
      extId = u.hostname;
      let p = decodeURIComponent(u.pathname);
      if (p.startsWith("/")) p = p.slice(1);
      pathnameRest = p;
    } else {
      let p = decodeURIComponent(u.pathname);
      if (p.startsWith("/")) p = p.slice(1);
      const parts = p.split("/").filter(Boolean);
      if (parts.length === 0) {
        return new Response(null, { status: 400 });
      }
      extId = decodeURIComponent(parts[0]!);
      pathnameRest = parts.slice(1).join("/");
    }
    let pathname = pathnameRest;
    if (!pathname) pathname = "index.html";
    const fsPath = resolveExtensionFilePath(
      extId,
      pathname,
      extensionRootIndex,
    );
    if (!fsPath) {
      return new Response(null, { status: 404 });
    }
    try {
      const buf = await readFile(fsPath);
      const ext = path.extname(fsPath).toLowerCase();
      const ct = MIME[ext] ?? "application/octet-stream";
      let body: BodyInit = new Uint8Array(buf);
      if (ext === ".html" || ext === ".htm") {
        const html = buf.toString("utf-8");
        body = injectHtmlDarkClassBridge(html, readerThemeIdForExtensionHtml);
      }
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": ct,
          "Cache-Control": "no-cache",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
