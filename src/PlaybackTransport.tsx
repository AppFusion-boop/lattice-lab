import { Play, Pause, RotateCcw, Timer } from "lucide-react";
import type { Playback } from "./usePlayback";
import { playbackLabel } from "./core/playback-clock";
export function PlaybackTransport({
  playback,
  duration,
  ready,
  running,
  onPlay,
  onSettings,
}: {
  playback: Playback;
  duration: number;
  ready: boolean;
  running: boolean;
  onPlay: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="flow-transport" aria-label="ფლოუს დროის მართვა">
      <button
        className="primary-soft"
        aria-label={playback.playing ? "ფლოუს პაუზა" : "ფლოუს დაკვრა"}
        onClick={() => (playback.playing ? playback.pause() : onPlay())}
        disabled={running}
      >
        {playback.playing ? <Pause size={15} /> : <Play size={15} />}{" "}
        {running ? "მზადდება…" : playback.playing ? "პაუზა" : "დაკვრა"}
      </button>
      <button aria-label="დროის განულება" onClick={playback.reset}>
        <RotateCcw size={15} />
      </button>
      <div className="flow-clock">
        <strong>
          {playback.time.toFixed(2)} <small>/ {duration.toFixed(2)} წმ</small>
        </strong>
        <span>{playbackLabel(playback.phase)}</span>
      </div>
      <input
        type="range"
        aria-label="ფლოუს დრო"
        min="0"
        max={duration}
        step="0.005"
        value={playback.time}
        disabled={!ready}
        onChange={(e) => playback.seek(Number(e.target.value))}
      />
      <select
        aria-label="დროის სიჩქარე"
        value={playback.speed}
        onChange={(e) => playback.setSpeed(Number(e.target.value))}
      >
        {[0.1, 0.25, 0.5, 1, 2].map((v) => (
          <option key={v} value={v}>
            {v}×{v === 1 ? " · რეალური დრო" : ""}
          </option>
        ))}
      </select>
      <button onClick={onSettings} title="ხანგრძლივობა და დისკრეტიზაცია">
        <Timer size={15} />
        <span>{duration} წმ</span>
      </button>
    </div>
  );
}
