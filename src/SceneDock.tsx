import { useState, useEffect } from "react";
import { Maximize2, X, Box } from "lucide-react";
import type { Project, Run } from "./core/types";
import { ScenePreview } from "./SceneEditor";
export function SceneDock({
  project,
  run,
  time,
  onOpen,
  onSelect,
  onClose,
  onReady,
}: {
  project: Project;
  run: Run | null;
  time: number;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
  onReady: () => void;
}) {
  useEffect(() => {
    const frame = requestAnimationFrame(onReady);
    return () => cancelAnimationFrame(frame);
  }, []);
  const scenes = project.nodes.filter(
    (n) => n.kind === "scene2d" || n.kind === "scene3d",
  );
  const [picked, setPicked] = useState<string[] | null>(null);
  const ids = picked ?? scenes.slice(0, 2).map((n) => n.id);
  const visible = scenes.filter((n) => ids.includes(n.id));
  return (
    <section className="scene-dock" aria-label="სცენების ცოცხალი ხედები">
      <header>
        <b>
          <Box size={14} />
          სცენების ცოცხალი ხედები
        </b>
        <span>{time.toFixed(2)} წმ</span>
        <select
          aria-label="საჩვენებელი სცენის დამატება"
          value=""
          onChange={(e) => {
            if (e.target.value) setPicked([...ids, e.target.value]);
          }}
        >
          <option value="">+ სცენის დამატება</option>
          {scenes
            .filter((n) => !ids.includes(n.id))
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
        </select>
        <button aria-label="სცენების ხედების დამალვა" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="scene-dock-grid">
        {visible.map((n) => (
          <article key={n.id}>
            <header>
              <b>{n.label}</b>
              <button
                aria-label={n.label + " — სცენის გახსნა"}
                onClick={() => onOpen(n.id)}
              >
                <Maximize2 size={13} />
              </button>
              <button
                aria-label={n.label + " — ხედის მოხსნა"}
                onClick={() => setPicked(ids.filter((id) => id !== n.id))}
              >
                <X size={13} />
              </button>
            </header>
            <ScenePreview
              node={n}
              project={project}
              run={run}
              time={time}
              onSelect={onSelect}
              compact
            />
          </article>
        ))}
      </div>
      {!visible.length && (
        <p>ზედა სიიდან აირჩიეთ სცენა, რომლის დაკვირვებაც გსურთ.</p>
      )}
    </section>
  );
}
