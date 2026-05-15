import { createHash, randomBytes } from "node:crypto";
import WebSocket from "ws";
import type { VoiceReadEdgeTtsRequest } from "@shared/voiceReadEdgeIpc";

const EDGE_SPEECH_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const EDGE_API_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = "143";

const WIN_EPOCH_OFFSET = 11644473600n;
const S_TO_NS = 1000000000n;

function sha256HexUpper(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").toUpperCase();
}

async function generateSecMsGec(): Promise<string> {
  let ticks = BigInt(Math.floor(Date.now() / 1000));
  ticks += WIN_EPOCH_OFFSET;
  ticks -= ticks % 300n;
  ticks *= S_TO_NS / 100n;
  const strToHash = `${ticks.toString()}${EDGE_API_TOKEN}`;
  return sha256HexUpper(strToHash);
}

function generateMuid(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

function randomHex(len: number): string {
  return randomBytes(len).toString("hex");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function genSSML(
  lang: string,
  text: string,
  voice: string,
  rate: number,
  pitch: number,
): string {
  const rateStr = `${rate >= 1 ? "+" : ""}${Math.round((rate - 1) * 100)}%`;
  const pitchStr = `${pitch >= 1 ? "+" : ""}${Math.round((pitch - 1) * 50)}Hz`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${rateStr}" pitch="${pitchStr}">${escapeXml(text)}</prosody></voice></speak>`;
}

function genMessage(headers: Record<string, string>, content: string): string {
  let header = "";
  for (const key of Object.keys(headers)) {
    header += `${key}: ${headers[key]}\r\n`;
  }
  return `${header}\r\n${content}`;
}

/**
 * 返回单段 MP3（24kHz mono），供渲染进程播放。
 */
export async function synthesizeEdgeTtsMp3(
  req: VoiceReadEdgeTtsRequest,
): Promise<ArrayBuffer> {
  const text = req.text?.trim() ?? "";
  if (!text) {
    throw new Error("Edge TTS：文本为空");
  }
  const voice = req.voice?.trim() || "zh-CN-XiaoxiaoNeural";
  const lang = req.lang?.trim() || "zh-CN";
  const rate = Number.isFinite(req.rate) ? req.rate : 1;
  const pitch = Number.isFinite(req.pitch) ? req.pitch : 1;

  const connectId = randomHex(16);
  const secMsGec = await generateSecMsGec();
  const params = new URLSearchParams({
    ConnectionId: connectId,
    TrustedClientToken: EDGE_API_TOKEN,
    "Sec-MS-GEC": secMsGec,
    "Sec-MS-GEC-Version": `1-${CHROMIUM_FULL_VERSION}`,
  });
  const url = `${EDGE_SPEECH_URL}?${params.toString()}`;

  const headers: Record<string, string> = {
    "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    Cookie: `muid=${generateMuid()};`,
  };

  const date = new Date().toString();
  const ssml = genSSML(lang, text, voice, rate, pitch);

  const configMsg = genMessage(
    {
      "Content-Type": "application/json; charset=utf-8",
      Path: "speech.config",
      "X-Timestamp": date,
    },
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled: false,
              wordBoundaryEnabled: true,
            },
            outputFormat: "audio-24khz-48kbitrate-mono-mp3",
          },
        },
      },
    }),
  );

  const ssmlMsg = genMessage(
    {
      "Content-Type": "application/ssml+xml",
      Path: "ssml",
      "X-RequestId": connectId,
      "X-Timestamp": date,
    },
    ssml,
  );

  return new Promise((resolve, reject) => {
    let audioData = new ArrayBuffer(0);
    let settled = false;
    let lastResponseBody = "";

    const ws = new WebSocket(url, { headers });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error("Edge TTS 超时（30s）"));
      }
    }, 30_000);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    ws.on("message", (data: WebSocket.RawData) => {
      try {
        const buf =
          typeof data === "string"
            ? Buffer.from(data, "utf8")
            : Buffer.isBuffer(data)
              ? data
              : Array.isArray(data)
                ? Buffer.concat(data)
                : Buffer.from(data as ArrayBuffer);
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        if (bytes.length >= 4) {
          const headerLength = (bytes[0]! << 8) | bytes[1]!;
          if (
            headerLength > 0 &&
            headerLength < 65536 &&
            bytes.length >= headerLength + 2
          ) {
            const newBody = bytes.slice(2 + headerLength);
            const merged = new Uint8Array(
              audioData.byteLength + newBody.byteLength,
            );
            merged.set(new Uint8Array(audioData), 0);
            merged.set(newBody, audioData.byteLength);
            audioData = merged.buffer;
            return;
          }
        }

        const text = buf.toString("utf8");
        const responseIdx = text.search(/Path:\s*response\b/i);
        if (responseIdx >= 0) {
          const sep = text.indexOf("\r\n\r\n", responseIdx);
          if (sep >= 0) lastResponseBody = text.slice(sep + 4).trim();
        }
        if (text.includes("Path:turn.end") || text.includes("Path: turn.end")) {
          try {
            ws.close();
          } catch {
            // ignore
          }
          if (!audioData.byteLength) {
            settle(() =>
              reject(
                new Error(
                  `Edge TTS 无音频数据${lastResponseBody ? `：${lastResponseBody.slice(0, 200)}` : ""}`,
                ),
              ),
            );
          } else {
            settle(() => resolve(audioData));
          }
        }
      } catch {
        // ignore frame errors
      }
    });

    ws.on("error", (err) => {
      settle(() =>
        reject(
          new Error(
            `Edge TTS WebSocket 错误：${err instanceof Error ? err.message : String(err)}`,
          ),
        ),
      );
    });

    ws.on("close", () => {
      if (settled) return;
      if (!audioData.byteLength) {
        settle(() =>
          reject(
            new Error(
              `Edge TTS 连接关闭且无音频${lastResponseBody ? `：${lastResponseBody.slice(0, 200)}` : ""}`,
            ),
          ),
        );
      } else {
        settle(() => resolve(audioData));
      }
    });

    ws.on("open", () => {
      ws.send(configMsg);
      ws.send(ssmlMsg);
    });
  });
}
