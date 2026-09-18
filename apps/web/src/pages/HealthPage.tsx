import HealthStatus from "../components/HealthStatus";
import { useHealth } from "../hooks/useHealth";

export default function HealthPage() {
  const { state, reload } = useHealth();

  return (
    <section>
      <h1>API status</h1>
      <HealthStatus state={state} />
      <button type="button" onClick={() => void reload()}>
        Refresh
      </button>
    </section>
  );
}
