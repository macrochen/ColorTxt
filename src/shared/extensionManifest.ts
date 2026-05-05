/**
 * ColorTxt 扩展清单（与 VS Code package.json 子集对齐 + entry）。
 */

export type ColortxtExtensionView = {
  id: string;
  name: string;
  /** 相对扩展根目录的 HTML 入口 */
  entry: string;
};

export type ColortxtViewsContainers = {
  activitybar?: Array<{
    id: string;
    title: string;
    icon: string;
  }>;
};

export type ColortxtContributes = {
  viewsContainers?: ColortxtViewsContainers;
  views?: Record<string, ColortxtExtensionView[]>;
};

export type ColortxtExtensionPackageJson = {
  name: string;
  displayName: string;
  description?: string;
  version?: string;
  publisher?: string;
  engines?: { colortxt?: string };
  activationEvents?: string[];
  main?: string;
  contributes?: ColortxtContributes;
};

const NAME_RE = /^[a-z0-9._-]+$/;

export type ManifestParseResult =
  | { ok: true; manifest: ColortxtExtensionPackageJson }
  | { ok: false; error: string };

export function parseExtensionPackageJson(
  raw: unknown,
): ManifestParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "package.json 须为对象" };
  }
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const displayName =
    typeof o.displayName === "string" ? o.displayName.trim() : "";
  if (!name || !NAME_RE.test(name)) {
    return {
      ok: false,
      error: "package.json 缺少合法 name（扩展 id，仅小写字母、数字、._-）",
    };
  }
  if (!displayName) {
    return { ok: false, error: "package.json 缺少 displayName" };
  }
  const contributes = o.contributes;
  if (!contributes || typeof contributes !== "object" || Array.isArray(contributes)) {
    return { ok: false, error: "package.json 缺少 contributes" };
  }
  const c = contributes as ColortxtContributes;
  const activity = c.viewsContainers?.activitybar;
  if (!Array.isArray(activity) || activity.length === 0) {
    return {
      ok: false,
      error: "contributes.viewsContainers.activitybar 不能为空",
    };
  }
  const views = c.views;
  if (!views || typeof views !== "object" || Array.isArray(views)) {
    return { ok: false, error: "contributes.views 必须为对象" };
  }
  for (const container of activity) {
    if (!container.id || typeof container.id !== "string") {
      return { ok: false, error: "activitybar 项缺少 id" };
    }
    if (!container.title || typeof container.title !== "string") {
      return { ok: false, error: `activitybar[${container.id}] 缺少 title` };
    }
    if (!container.icon || typeof container.icon !== "string") {
      return { ok: false, error: `activitybar[${container.id}] 缺少 icon` };
    }
    const bucket = views[container.id];
    if (!Array.isArray(bucket) || bucket.length === 0) {
      return {
        ok: false,
        error: `contributes.views["${container.id}"] 不能为空`,
      };
    }
    for (const v of bucket) {
      if (!v || typeof v !== "object") {
        return { ok: false, error: "views 项格式错误" };
      }
      const view = v as ColortxtExtensionView;
      if (!view.id || typeof view.id !== "string") {
        return { ok: false, error: "view 缺少 id" };
      }
      if (!view.name || typeof view.name !== "string") {
        return { ok: false, error: `view ${view.id} 缺少 name` };
      }
      if (!view.entry || typeof view.entry !== "string") {
        return { ok: false, error: `view ${view.id} 缺少 entry` };
      }
    }
  }
  return {
    ok: true,
    manifest: o as unknown as ColortxtExtensionPackageJson,
  };
}

/** 展开活动栏上的每一个视图（含容器图标路径） */
export function flattenExtensionViews(
  manifest: ColortxtExtensionPackageJson,
): Array<{
  viewId: string;
  viewTitle: string;
  entry: string;
  containerId: string;
  containerTitle: string;
  containerIcon: string;
}> {
  const out: Array<{
    viewId: string;
    viewTitle: string;
    entry: string;
    containerId: string;
    containerTitle: string;
    containerIcon: string;
  }> = [];
  const activity = manifest.contributes?.viewsContainers?.activitybar ?? [];
  const views = manifest.contributes?.views ?? {};
  for (const ac of activity) {
    const bucket = views[ac.id];
    if (!bucket) continue;
    for (const v of bucket) {
      out.push({
        viewId: v.id,
        viewTitle: v.name,
        entry: v.entry,
        containerId: ac.id,
        containerTitle: ac.title,
        containerIcon: ac.icon,
      });
    }
  }
  return out;
}
