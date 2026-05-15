/** 主进程 Edge TTS 合成请求（与 preload IPC 对齐） */
export type VoiceReadEdgeTtsRequest = {
  text: string;
  voice: string;
  lang: string;
  /** 相对语速，1 为默认（映射到 SSML prosody） */
  rate: number;
  /** 相对音调，1 为默认 */
  pitch: number;
};
