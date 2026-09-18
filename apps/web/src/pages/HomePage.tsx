import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <section>
      <h1>Adaptive Learning</h1>
      <p>
        A local-first study game for technical certifications. Phase 1 ships one
        real learning module: AWS Certified CloudOps Engineer - Associate
        (SOA-C03), Task 1.1.
      </p>
      <p>
        <Link to="/demo">Try the free demo</Link> ·{" "}
        <Link to="/certifications">Browse certifications</Link>
      </p>
    </section>
  );
}
