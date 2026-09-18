import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "../api/client";
import { useCatalog } from "../hooks/useCatalog";
import { getDeviceId, loadMission, saveMission } from "../state/persistence";

export default function TaskPage() {
  const { certificationId, taskId } = useParams();
  const { state } = useCatalog();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const certification =
    state.status === "loaded"
      ? state.data.certifications.find((entry) => entry.id === certificationId)
      : undefined;
  const version = certification?.versions[0];
  const domain = version?.domains.find((entry) =>
    entry.tasks.some((task) => task.id === taskId),
  );
  const task = domain?.tasks.find((entry) => entry.id === taskId);

  const stored = loadMission();
  const resumable =
    stored && stored.mission.task_id === taskId && !stored.finished
      ? stored
      : null;

  const start = async () => {
    if (!certification || !version || !taskId) {
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const result = await api.POST("/v1/missions/issue", {
        body: {
          device_id: getDeviceId(),
          certification_id: certification.id,
          certification_version: version.id,
          task_id: taskId,
        },
      });

      if (result.error || !result.data) {
        setError(`Could not start mission (HTTP ${result.response.status})`);
        return;
      }

      saveMission({
        mission: result.data,
        currentIndex: 0,
        attempts: [],
        startedAt: new Date().toISOString(),
        finished: false,
      });
      navigate(`/missions/${result.data.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Network error");
    } finally {
      setStarting(false);
    }
  };

  if (state.status === "loading") {
    return <p role="status">Loading task…</p>;
  }

  if (state.status === "error") {
    return <p role="alert">Could not load the catalog: {state.message}</p>;
  }

  if (!certification || !version || !domain || !task) {
    return <p role="alert">Task not found.</p>;
  }

  return (
    <section>
      <p>
        <Link to="/certifications">← Certifications</Link>
      </p>
      <h1>{certification.name}</h1>
      <h2>{domain.name}</h2>
      <h3>
        Task {task.id}: {task.name}
      </h3>
      <p className="muted">
        {task.question_count} questions · content {version.content_version}
      </p>

      {error ? <p role="alert">{error}</p> : null}

      {resumable ? (
        <p>
          <Link to={`/missions/${resumable.mission.id}`}>Resume mission</Link>
        </p>
      ) : null}

      <button
        type="button"
        className="primary"
        disabled={starting}
        onClick={() => void start()}
      >
        Start mission
      </button>
    </section>
  );
}
