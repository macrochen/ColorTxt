/** 与主进程 `aiBookHash.hashBook` 算法一致（SHA-1 取前 16 hex） */
export async function hashBookBrowser(
  sessionFilePath: string,
  size: number,
  mtimeMs: number,
): Promise<string> {
  const raw = `${sessionFilePath}::${size}::${Math.floor(mtimeMs)}`;
  const enc = new TextEncoder().encode(raw);
  const buf = await crypto.subtle.digest("SHA-1", enc);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex.slice(0, 16);
}
