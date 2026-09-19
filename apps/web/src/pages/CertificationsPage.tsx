import { Link } from "react-router-dom";

import { useCatalog } from "../hooks/useCatalog";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { CATALOG, buildCatalog } from "../state/catalogMeta";

export default function CertificationsPage() {
  useDocumentTitle("Learning Tracks · Adaptive Learning");
  const { state, reload } = useCatalog();

  if (state.status === "loading") {
    return <p role="status">Loading learning tracks…</p>;
  }

  if (state.status === "error") {
    return (
      <div role="alert">
        <p>Could not load learning tracks: {state.message}</p>
        <button type="button" onClick={() => void reload()}>
          Retry
        </button>
      </div>
    );
  }

  const sections = buildCatalog(CATALOG, state.data.certifications);

  return (
    <section className="catalog">
      <h1>Learning Tracks</h1>
      <p className="muted">
        Choose a certification or learning track to study. Cards marked WIP are
        planned and not available yet.
      </p>

      {sections.map((section) => (
        <section
          key={section.id}
          className="catalog-category"
          aria-label={section.label}
        >
          <h2>{section.label}</h2>
          <ul className="cert-grid">
            {section.cards.map((card) => (
              <li key={card.id}>
                {card.available ? (
                  <Link
                    className="cert-card available"
                    to={`/tracks/${card.id}`}
                  >
                    {section.kind === "certification" ? (
                      <span className="cert-vendor">{card.examCode}</span>
                    ) : null}
                    <span className="cert-name">{card.name}</span>
                    <span className="cert-go" aria-hidden="true">
                      →
                    </span>
                  </Link>
                ) : (
                  <div className="cert-card wip" aria-disabled="true">
                    {section.kind === "certification" ? (
                      <span className="cert-vendor">{card.examCode}</span>
                    ) : null}
                    <span className="cert-name">{card.name}</span>
                    <span className="badge wip-badge">WIP</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
