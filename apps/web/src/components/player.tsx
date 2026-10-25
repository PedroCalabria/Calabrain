/**
 * Recording player (RF15): speed control and clickable time markers on the track. On wide screens the
 * controls float over the video (approved desktop design); on small screens they sit below it with
 * 44px tap targets (mobile design).
 */
import { formatTime, type Marker } from "@calabrain/shared";
import clsx from "clsx";
import { AudioLines, Maximize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent } from "react";

export interface PlayerHandle {
  seek: (t: number) => void;
  play: () => void;
  current: () => number;
}

const SPEEDS = [2, 1.5, 1.25, 1, 0.75];

export const Player = forwardRef<
  PlayerHandle,
  {
    src: string;
    kind: "video" | "audio";
    poster?: string | null;
    duration: number;
    markers: Marker[];
    onTime?: (t: number) => void;
  }
>(function Player({ src, kind, poster, duration: knownDuration, markers, onTime }, ref) {
  const media = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(knownDuration);
  const [speed, setSpeed] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);

  const seek = useCallback((to: number) => {
    const m = media.current;
    if (!m) return;
    m.currentTime = Math.max(0, Math.min(to, m.duration || duration));
    setT(m.currentTime);
  }, [duration]);

  useImperativeHandle(ref, () => ({
    seek,
    play: () => void media.current?.play(),
    current: () => media.current?.currentTime ?? 0,
  }), [seek]);

  useEffect(() => {
    const m = media.current;
    if (m) m.playbackRate = speed;
  }, [speed]);

  function toggle() {
    const m = media.current;
    if (!m) return;
    if (m.paused) void m.play();
    else m.pause();
  }

  function scrub(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * duration);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === " " || e.key === "k") (e.preventDefault(), toggle());
    if (e.key === "ArrowRight") (e.preventDefault(), seek(t + 5));
    if (e.key === "ArrowLeft") (e.preventDefault(), seek(t - 5));
  }

  const pct = duration ? (t / duration) * 100 : 0;

  return (
    <div ref={frame} className="player-frame" onKeyDown={onKey}>
      <div className="relative overflow-hidden rounded-[14px] bg-[#2b2520]">
        <video
          ref={media}
          src={src}
          poster={poster ?? undefined}
          preload="metadata"
          playsInline
          className={clsx("block aspect-video w-full bg-black/90 object-contain", kind === "audio" && "invisible")}
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => {
            setT(e.currentTarget.currentTime);
            onTime?.(e.currentTarget.currentTime);
          }}
          onVolumeChange={(e) => (setMuted(e.currentTarget.muted), setVolume(e.currentTarget.volume))}
        />
        {kind === "audio" ? (
          <button type="button" onClick={toggle} className="absolute inset-0 grid place-items-center text-white/80" aria-label={playing ? "Pause" : "Play"}>
            <span className="flex flex-col items-center gap-3">
              <AudioLines size={40} strokeWidth={1.5} aria-hidden />
              <span className="text-[13px]">Audio recording</span>
            </span>
          </button>
        ) : !playing && t === 0 ? (
          <button type="button" onClick={toggle} aria-label="Play" className="absolute top-1/2 left-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-transform duration-[250ms] hover:scale-105">
            <Play size={26} strokeWidth={1.75} className="ml-1" aria-hidden />
          </button>
        ) : null}

        {/* Desktop: control bar over the video */}
        <div className="pbar absolute inset-x-4 bottom-4 hidden items-center gap-3 rounded-[10px] bg-black/55 px-3 py-2 text-white backdrop-blur-md lg:flex">
          {controls()}
        </div>
      </div>

      {/* Small screens: controls below the video */}
      <div className="mt-1 flex items-center gap-2 lg:hidden">
        <button type="button" className="btn btn-bare -ml-3" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
          {playing ? <Pause size={22} strokeWidth={1.75} aria-hidden /> : <Play size={22} strokeWidth={1.75} aria-hidden />}
        </button>
        {trackEl(false)}
        <button type="button" className="flex h-11 flex-none items-center pl-2 text-sm font-medium text-ink" aria-label="Playback speed" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + SPEEDS.length - 1) % SPEEDS.length]!)}>
          {speed}×
        </button>
      </div>
      <div className="flex items-center justify-between text-[13px] leading-[18px] text-ink-muted lg:hidden">
        <span className="font-mono text-xs">
          <b className="font-medium text-ink">{formatTime(t)}</b> / {formatTime(duration)}
        </span>
        {kind === "video" ? (
          <button type="button" className="btn btn-ghost -mr-2 h-10" onClick={() => void frame.current?.querySelector("video")?.requestFullscreen()}>
            <Maximize size={16} strokeWidth={1.75} aria-hidden />
            Full screen
          </button>
        ) : null}
      </div>
    </div>
  );

  function trackEl(light: boolean) {
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(t)}
        aria-valuetext={`${formatTime(t)} of ${formatTime(duration)}`}
        className="relative flex h-11 flex-1 cursor-pointer items-center lg:h-6"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && scrub(e)}
      >
        <span className={clsx("absolute inset-x-0 h-1 rounded-full", light ? "bg-white/35" : "bg-surface-sunken")} />
        <span className={clsx("absolute left-0 h-1 rounded-full", light ? "bg-white" : "bg-brand")} style={{ width: `${pct}%` }} />
        {markers.map((m) => (
          <span
            key={m.id}
            title={`${formatTime(m.tSeconds)} · ${m.label}`}
            className="absolute h-3 w-[3px] -translate-x-1/2 rounded-full bg-brand"
            style={{ left: `${duration ? (m.tSeconds / duration) * 100 : 0}%` }}
          />
        ))}
        <span
          className={clsx("absolute size-3.5 -translate-x-1/2 rounded-full", light ? "bg-white shadow" : "bg-surface-raised shadow-[0_0_0_1.5px_var(--border-strong)]")}
          style={{ left: `${pct}%` }}
        />
      </div>
    );
  }

  function controls() {
    return (
      <>
        <button type="button" className="pb-btn" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
          {playing ? <Pause size={16} strokeWidth={1.75} aria-hidden /> : <Play size={16} strokeWidth={1.75} aria-hidden />}
        </button>
        {trackEl(true)}
        <span className="font-mono text-xs font-medium whitespace-nowrap tabular-nums">
          {formatTime(t)} / {formatTime(duration)}
        </span>
        <span className="relative">
          {speedOpen ? (
            <span role="menu" aria-label="Playback speed" className="pop absolute bottom-9 left-1/2 flex w-16 -translate-x-1/2 flex-col gap-0.5 rounded-[10px] bg-nav-active p-1 shadow-pop" style={{ transformOrigin: "bottom center" }}>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="menuitemradio"
                  aria-checked={s === speed}
                  className={clsx("h-7 rounded-[7px] text-xs font-medium", s === speed ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10")}
                  onClick={() => (setSpeed(s), setSpeedOpen(false))}
                >
                  {s}×
                </button>
              ))}
            </span>
          ) : null}
          <button type="button" className={clsx("rounded-[6px] border border-white/35 px-1.5 py-1 font-mono text-[11px] leading-none", speedOpen && "bg-white/15")} aria-label="Playback speed" aria-haspopup="menu" aria-expanded={speedOpen} onClick={() => setSpeedOpen((o) => !o)}>
            {speed}×
          </button>
        </span>
        <span className="flex items-center gap-2">
          <button type="button" className="pb-btn" aria-label={muted ? "Unmute" : "Mute"} onClick={() => media.current && (media.current.muted = !media.current.muted)}>
            {muted || volume === 0 ? <VolumeX size={16} strokeWidth={1.75} aria-hidden /> : <Volume2 size={16} strokeWidth={1.75} aria-hidden />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            aria-label="Volume"
            className="volume h-1 w-12 cursor-pointer"
            onChange={(e) => {
              if (!media.current) return;
              media.current.volume = Number(e.target.value);
              media.current.muted = Number(e.target.value) === 0;
            }}
          />
        </span>
        {kind === "video" ? (
          <button type="button" className="pb-btn" aria-label="Full screen" onClick={() => void frame.current?.querySelector("video")?.requestFullscreen()}>
            <Maximize size={16} strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
      </>
    );
  }
});
