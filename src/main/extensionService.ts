import { app } from "electron";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  flattenExtensionViews,
  parseExtensionPackageJson,
  type ColortxtExtensionPackageJson,
} from "@shared/extensionManifest";

const USER_EXT_SUBDIR = "extensions";
const STATE_FILE = "extensions-state.json";
const BUILTIN_SUBDIR = "builtin-extensions";
const MAX_CTIX_BYTES = 80 * 1024 * 1024;

export type ExtensionStateFile = {
  v: 1;
  userEnabled?: Record<string, boolean>;
  builtinEnabled?: Record<string, boolean>;
};

let devExtensionPaths: string[] = [];
let extensionDevOverride = false;

export function setExtensionDevModeAllowed(allowed: boolean): void {
  extensionDevOverride = allowed;
}

export function isExtensionDevLoadingAllowed(): boolean {
  if (extensionDevOverride) return true;
  if (!app.isPackaged) return true;
  return process.env.COLORTXT_EXTENSION_DEV === "1";
}

export function setDevExtensionPathsFromArgv(argv: string[]): void {
  const out: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--extension-development-path=")) {
      const p = arg.slice("--extension-development-path=".length).trim();
      if (p) out.push(path.resolve(p));
    }
  }
  devExtensionPaths = out;
}

export function getDevExtensionPaths(): readonly string[] {
  return devExtensionPaths;
}

export function getUserExtensionsDir(): string {
  return path.join(app.getPath("userData"), USER_EXT_SUBDIR);
}

function getStatePath(): string {
  return path.join(app.getPath("userData"), STATE_FILE);
}

export function getBuiltinExtensionsDir(): string | null {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, BUILTIN_SUBDIR);
  }
  return path.join(app.getAppPath(), "resources", BUILTIN_SUBDIR);
}

async function readState(): Promise<ExtensionStateFile> {
  try {
    const raw = await readFile(getStatePath(), "utf-8");
    const o = JSON.parse(raw) as ExtensionStateFile;
    if (o && o.v === 1) return o;
  } catch {
    // ignore
  }
  return { v: 1, userEnabled: {}, builtinEnabled: {} };
}

export async function writeExtensionState(
  state: ExtensionStateFile,
): Promise<void> {
  await writeFile(getStatePath(), JSON.stringify(state, null, 2), "utf-8");
}

export async function setExtensionEnabled(
  name: string,
  enabled: boolean,
  builtin: boolean,
): Promise<void> {
  const s = await readState();
  if (builtin) {
    s.builtinEnabled = { ...s.builtinEnabled, [name]: enabled };
  } else {
    s.userEnabled = { ...s.userEnabled, [name]: enabled };
  }
  await writeExtensionState(s);
}

function isUserExtensionEnabled(
  name: string,
  state: ExtensionStateFile,
): boolean {
  return state.userEnabled?.[name] !== false;
}

function isBuiltinExtensionEnabled(
  name: string,
  state: ExtensionStateFile,
): boolean {
  return state.builtinEnabled?.[name] !== false;
}

async function loadManifestFromDir(
  dir: string,
): Promise<ColortxtExtensionPackageJson | null> {
  try {
    const buf = await readFile(path.join(dir, "package.json"), "utf-8");
    const pr = parseExtensionPackageJson(JSON.parse(buf) as unknown);
    if (!pr.ok) return null;
    return pr.manifest;
  } catch {
    return null;
  }
}

export type ExtensionListRow = {
  name: string;
  displayName: string;
  description: string;
  version: string;
  builtin: boolean;
  dev: boolean;
  enabled: boolean;
  rootFsPath: string;
  manifest: ColortxtExtensionPackageJson;
  views: ReturnType<typeof flattenExtensionViews>;
};

export async function listAllExtensionRows(): Promise<ExtensionListRow[]> {
  const state = await readState();
  const userRoot = getUserExtensionsDir();
  await mkdir(userRoot, { recursive: true });
  const rows: ExtensionListRow[] = [];

  const appendFromDir = async (root: string, builtin: boolean) => {
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      return;
    }
    for (const name of names) {
      const sub = path.join(root, name);
      let st;
      try {
        st = await stat(sub);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const manifest = await loadManifestFromDir(sub);
      if (!manifest || manifest.name !== name) continue;
      const enabled = builtin
        ? isBuiltinExtensionEnabled(manifest.name, state)
        : isUserExtensionEnabled(manifest.name, state);
      rows.push({
        name: manifest.name,
        displayName: manifest.displayName,
        description: manifest.description ?? "",
        version: manifest.version ?? "0.0.0",
        builtin,
        dev: false,
        enabled,
        rootFsPath: sub,
        manifest,
        views: flattenExtensionViews(manifest),
      });
    }
  };

  const builtinDir = getBuiltinExtensionsDir();
  if (builtinDir) await appendFromDir(builtinDir, true);
  await appendFromDir(userRoot, false);

  if (isExtensionDevLoadingAllowed() && devExtensionPaths.length > 0) {
    for (const root of devExtensionPaths) {
      const manifest = await loadManifestFromDir(root);
      if (!manifest) continue;
      const i = rows.findIndex((r) => r.name === manifest.name);
      const row: ExtensionListRow = {
        name: manifest.name,
        displayName: manifest.displayName,
        description: manifest.description ?? "",
        version: manifest.version ?? "0.0.0",
        builtin: false,
        dev: true,
        enabled: true,
        rootFsPath: root,
        manifest,
        views: flattenExtensionViews(manifest),
      };
      if (i >= 0) rows.splice(i, 1, row);
      else rows.push(row);
    }
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildRootIndexFromRows(
  rows: ExtensionListRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!r.enabled) continue;
    map.set(r.name, r.rootFsPath);
  }
  return map;
}

function safeSegment(seg: string): boolean {
  if (seg === "" || seg === "." || seg === "..") return false;
  if (seg.includes("/") || seg.includes("\\")) return false;
  return true;
}

function assertPathInsideRoot(root: string, rel: string): string {
  const resolvedRoot = path.resolve(root);
  const joined = path.normalize(path.join(resolvedRoot, rel));
  const prefix = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;
  if (joined !== resolvedRoot && !joined.startsWith(prefix)) {
    throw new Error("非法路径");
  }
  return joined;
}

export function resolveExtensionFilePath(
  extId: string,
  relativePath: string,
  rootIndex: Map<string, string>,
): string | null {
  const root = rootIndex.get(extId);
  if (!root) return null;
  const norm = path.normalize(relativePath).replace(/^[/\\]+/, "");
  const parts = norm.split(/[/\\]+/).filter(Boolean);
  for (const p of parts) {
    if (!safeSegment(p)) return null;
  }
  try {
    return assertPathInsideRoot(root, norm);
  } catch {
    return null;
  }
}

export async function installExtensionFromCtix(
  ctixPath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const st = await stat(ctixPath).catch(() => null);
  if (!st || !st.isFile()) {
    return { ok: false, error: "文件不存在" };
  }
  if (st.size > MAX_CTIX_BYTES) {
    return { ok: false, error: "安装包过大" };
  }
  const buf = await readFile(ctixPath);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    return { ok: false, error: "无效的 zip/.ctix" };
  }
  const pkgEntry = zip.file("package.json");
  if (!pkgEntry) {
    return { ok: false, error: "根目录缺少 package.json" };
  }
  const pkgText = await pkgEntry.async("string");
  let raw: unknown;
  try {
    raw = JSON.parse(pkgText) as unknown;
  } catch {
    return { ok: false, error: "package.json 不是合法 JSON" };
  }
  const pr = parseExtensionPackageJson(raw);
  if (!pr.ok) {
    return { ok: false, error: pr.error };
  }
  const extName = pr.manifest.name;
  const userRoot = getUserExtensionsDir();
  await mkdir(userRoot, { recursive: true });
  const target = path.join(userRoot, extName);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  const names = Object.keys(zip.files);
  for (const name of names) {
    const zf = zip.files[name];
    if (!zf || zf.dir) continue;
    const rel = name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rel || rel.startsWith("..") || rel.includes("../")) {
      return { ok: false, error: `非法 zip 路径: ${name}` };
    }
    const dest = path.join(target, rel);
    const resolvedDest = path.resolve(dest);
    const targetResolved = path.resolve(target);
    const prefix = targetResolved.endsWith(path.sep)
      ? targetResolved
      : targetResolved + path.sep;
    if (resolvedDest !== targetResolved && !resolvedDest.startsWith(prefix)) {
      return { ok: false, error: `路径穿越: ${name}` };
    }
    await mkdir(path.dirname(resolvedDest), { recursive: true });
    const data = await zf.async("nodebuffer");
    await writeFile(resolvedDest, data);
  }

  return { ok: true };
}

export async function uninstallUserExtension(
  name: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await listAllExtensionRows();
  const row = rows.find((r) => r.name === name);
  if (!row) return { ok: false, error: "扩展不存在" };
  if (row.builtin) return { ok: false, error: "无法卸载内置扩展" };
  if (row.dev) {
    return { ok: false, error: "开发模式扩展请从启动参数移除" };
  }
  const userRoot = getUserExtensionsDir();
  const target = path.join(userRoot, name);
  try {
    await rm(target, { recursive: true, force: true });
  } catch (e) {
    return { ok: false, error: String(e) };
  }
  return { ok: true };
}
