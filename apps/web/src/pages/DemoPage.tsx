import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useCatalog } from "../hooks/useCatalog";
import { demoTasks, findDemoCertification } from "../state/demo";
import { startMission } from "../state/mission";

export default function DemoPage() {
  const { state, reload } = useCatalog();
  const navigate = useNavigate();
  const [startingTask, setStartingTask] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (
    certificationId: string,
    versionId: string,
    taskId: string,
  ) => {
    setStartingTask(taskId);
    setError(null);
    try {
      const mission = await startMission(certificationId, versionId, taskId);
      navigate(`/missions/${mission.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Network error");
    } finally {
      setStartingTask(null);
    }
  };

  if (state.status === "loading") {
    return <p role="status">Loading the demo…</p>;
  }

  if (state.status === "error") {
    return (
      <div role="alert">
        <p>Could not load the demo: {state.message}</p>
        <button type="button" onClick={() => void reload()}>
          Retry
        </button>
      </div>
    );
  }

  const demo = findDemoCertification(state.data.certifications);
  const tasks = demo ? demoTasks(demo) : [];

  return (
    <section>
      <h1>Try the demo</h1>
      <p>
        Take the demo questions for free — no account needed. Each mission is
        short, works on mobile, and uses tactile puzzles instead of plain
        multiple choice.
      </p>

      {error ? <p role="alert">{error}</p> : null}

      {!demo || tasks.length === 0 ? (
        <p>Demo content is not available right now.</p>
      ) : (
        <article className="certification">
          <h2>{demo.name}</h2>
          <p className="muted">
            {demo.vendor} · {demo.exam_code}
          </p>
          <ul className="domain-list">
            {tasks.map((task) => (
              <li key={task.taskId}>
                <div>
                  <strong>Task {task.taskId}</strong>: {task.taskName}
                </div>
                <div className="muted">
                  {task.domainName} · {task.questionCount} questions
                </div>
                <button
                  type="button"
                  className="primary"
                  disabled={startingTask !== null}
                  onClick={() => void start(demo.id, task.versionId, task.taskId)}
                >
                  {startingTask === task.taskId
                    ? "Starting…"
                    : "Start demo mission"}
                </button>
              </li>
            ))}
          </ul>
        </article>
      )}
    </section>
  );
}
