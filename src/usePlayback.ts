import { useEffect, useRef, useState, useCallback } from "react";
import { PlaybackClock } from "./core/playback-clock";

export function usePlayback(duration: number, revision: string) {
  const engine = useRef(new PlaybackClock(duration));
  const [state, setState] = useState(() => engine.current.snapshot());
  const publish = useCallback(() => setState(engine.current.snapshot()), []);
  const play = useCallback(
    (ready: boolean) => {
      engine.current.play(ready);
      publish();
    },
    [publish],
  );
  const prepared = useCallback(
    (success: boolean) => {
      engine.current.prepared(success);
      publish();
    },
    [publish],
  );
  const pause = useCallback(() => {
    engine.current.pause();
    publish();
  }, [publish]);
  const seek = useCallback(
    (time: number) => {
      engine.current.seek(time);
      publish();
    },
    [publish],
  );
  const reset = useCallback(() => {
    engine.current.reset();
    publish();
  }, [publish]);
  const setSpeed = useCallback(
    (speed: number) => {
      engine.current.setSpeed(speed);
      publish();
    },
    [publish],
  );
  useEffect(() => {
    engine.current.reset(duration);
    publish();
  }, [duration, revision, publish]);
  useEffect(() => {
    if (state.phase !== "playing") return;
    let frame = 0,
      lastPublished = 0,
      disposed = false;
    const tick = (now: number) => {
      if (disposed) return;
      engine.current.step(now);
      if (now - lastPublished >= 32 || engine.current.phase !== "playing") {
        publish();
        lastPublished = now;
      }
      if (engine.current.phase === "playing")
        frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [state.phase, publish]);
  useEffect(() => {
    const onVisibility = () => {
      if (
        document.hidden &&
        ["playing", "preparing"].includes(engine.current.phase)
      )
        pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pause]);
  return {
    ...state,
    playing: state.phase === "playing",
    play,
    prepared,
    pause,
    seek,
    reset,
    setSpeed,
  };
}
export type Playback = ReturnType<typeof usePlayback>;
