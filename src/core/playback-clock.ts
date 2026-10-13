export type PlaybackPhase =
  "idle" | "preparing" | "playing" | "paused" | "complete";
export type PlaybackSnapshot = {
  time: number;
  speed: number;
  phase: PlaybackPhase;
};

// The clock owns simulation time. Computing signal arrays never advances it.
export class PlaybackClock {
  time = 0;
  speed = 1;
  phase: PlaybackPhase = "idle";
  private last: number | null = null;
  duration: number;
  constructor(duration: number) {
    this.duration = duration;
  }
  snapshot(): PlaybackSnapshot {
    return { time: this.time, speed: this.speed, phase: this.phase };
  }
  reset(duration = this.duration) {
    this.duration = duration;
    this.time = 0;
    this.phase = "idle";
    this.last = null;
  }
  play(ready: boolean) {
    if (this.time >= this.duration) this.time = 0;
    this.last = null;
    this.phase = ready ? "playing" : "preparing";
  }
  prepared(success: boolean) {
    if (this.phase !== "preparing") return;
    this.last = null;
    this.phase = success ? "playing" : "paused";
  }
  pause() {
    this.phase = "paused";
    this.last = null;
  }
  seek(time: number) {
    this.time = Math.max(0, Math.min(this.duration, time));
    this.pause();
  }
  setSpeed(speed: number) {
    if (Number.isFinite(speed) && speed > 0) this.speed = speed;
    this.last = null;
  }
  step(now: number) {
    if (this.phase !== "playing") return;
    const previous = this.last;
    this.last = now;
    if (previous === null) return;
    const elapsed = now - previous;
    // A suspended tab or a blocked renderer must not jump to the final frame.
    if (elapsed < 0 || elapsed > 250) return;
    this.time = Math.min(
      this.duration,
      this.time + (elapsed / 1000) * this.speed,
    );
    if (this.time >= this.duration) {
      this.phase = "complete";
      this.last = null;
    }
  }
}

export function playbackLabel(phase: PlaybackPhase) {
  return {
    idle: "მზადაა დასაკრავად",
    preparing: "სიმულაცია მზადდება…",
    playing: "მიმდინარეობს სიმულაცია",
    paused: "პაუზა",
    complete: "სიმულაცია დასრულდა",
  }[phase];
}
