import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <section>
      <h1>Adaptive Learning</h1>
      <p>
        A local-first study game for technical certifications. This Phase 0
        shell exists to prove the API contract and the deployment foundation.
      </p>
      <p>
        <Link to="/health">Check API status</Link>
      </p>
    </section>
  );
}
