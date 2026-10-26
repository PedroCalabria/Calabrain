/** ffprobe/ffmpeg helpers for recordings (RF14). */
import { spawn } from "node:child_process";

export interface Probe {
  durationS: number;
  container: string;
  video: { codec: string; width: number; height: number } | null;
  audio: { codec: string } | null;
}

function run(cmd: string, args: string[], timeoutMs = 30 * 60 * 1000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-8000)));
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", (err) => (clearTimeout(timer), reject(err)));
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(-800)}`));
    });
  });
}

export class MediaError extends Error {
  constructor(readonly reason: "corrupt" | "too_long" | "unsupported") {
    super(reason);
  }
}

export async function probe(path: string): Promise<Probe> {
  let out: string;
  try {
    ({ stdout: out } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], 60_000));
  } catch {
    throw new MediaError("corrupt");
  }
  const data = JSON.parse(out) as {
    format?: { duration?: string; format_name?: string };
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string; disposition?: { attached_pic?: number } }[];
  };
  const streams = data.streams ?? [];
  // Cover art in MP3/M4A shows up as a video stream; it isn't video.
  const v = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === "audio");
  const durationS = Number(data.format?.duration ?? v?.duration ?? a?.duration ?? NaN);
  if (!v && !a) throw new MediaError("corrupt");
  if (!Number.isFinite(durationS) || durationS <= 0) throw new MediaError("corrupt");
  return {
    durationS,
    container: data.format?.format_name ?? "",
    video: v ? { codec: v.codec_name ?? "", width: v.width ?? 0, height: v.height ?? 0 } : null,
    audio: a ? { codec: a.codec_name ?? "" } : null,
  };
}

const playableVideo = new Set(["h264", "vp8", "vp9", "av1"]);
const playableAudio = new Set(["aac", "mp3", "opus", "vorbis", "flac", "pcm_s16le", "pcm_s24le"]);

/**
 * What to do so every browser plays it: keep as is, remux into MP4 (H.264 in a .mov), or convert
 * (HEVC from an iPhone, ProRes...). Audio-only files play as they are when their codec is common.
 */
export function playbackPlan(p: Probe, mime: string): "keep" | "remux" | "transcode" {
  if (!p.video) return p.audio && playableAudio.has(p.audio.codec) ? "keep" : "transcode";
  const videoOk = playableVideo.has(p.video.codec);
  const audioOk = !p.audio || playableAudio.has(p.audio.codec);
  if (!videoOk || !audioOk) return "transcode";
  if (mime === "video/quicktime") return p.video.codec === "h264" ? "remux" : "transcode";
  if (mime === "video/webm" && p.video.codec === "h264") return "remux";
  return "keep";
}

export async function toMp4(src: string, dst: string, plan: "remux" | "transcode", hasVideo: boolean) {
  const common = ["-y", "-i", src, "-map", "0:v:0?", "-map", "0:a:0?", "-movflags", "+faststart"];
  if (!hasVideo) {
    await run("ffmpeg", ["-y", "-i", src, "-vn", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dst]);
    return;
  }
  const codecs =
    plan === "remux"
      ? ["-c", "copy"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-vf", "scale='min(1920,iw)':-2", "-c:a", "aac", "-b:a", "128k"];
  await run("ffmpeg", [...common, ...codecs, dst]);
}

/** Mono 16 kHz Opus: what transcription needs in phase 2, at a tenth of the size. */
export async function extractAudio(src: string, dst: string) {
  await run("ffmpeg", ["-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", dst]);
}

export async function thumbnail(src: string, dst: string, atS: number) {
  await run("ffmpeg", ["-y", "-ss", String(atS), "-i", src, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", dst], 120_000);
}
