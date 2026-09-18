import type { HealthState } from "../hooks/useHealth";

interface HealthStatusProps {
  state: HealthState;
}

export default function HealthStatus({ state }: HealthStatusProps) {
  if (state.status === "loading") {
    return <p role="status">Checking API…</p>;
  }

  if (state.status === "error") {
    return (
      <p role="alert" className="status-error">
        API unreachable: {state.message}
      </p>
    );
  }

  const { data } = state;

  return (
    <dl className="health-grid">
      <div>
        <dt>Status</dt>
        <dd>{data.status}</dd>
      </div>
      <div>
        <dt>Database</dt>
        <dd>{data.database}</dd>
      </div>
      <div>
        <dt>Service</dt>
        <dd>{data.service}</dd>
      </div>
      <div>
        <dt>Version</dt>
        <dd>{data.version}</dd>
      </div>
      <div>
        <dt>Uptime</dt>
        <dd>{data.uptime_seconds}s</dd>
      </div>
    </dl>
  );
}
