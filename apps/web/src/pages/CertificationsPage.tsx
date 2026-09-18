import { Link } from "react-router-dom";

import { useCatalog } from "../hooks/useCatalog";
import { CATALOG, buildCatalog } from "../state/catalogMeta";

export default function CertificationsPage() {
  const { state, reload } = useCatalog();

  if (state.status === "loading") {
    return <p role="status">Loading certifications…</p>;
  }

  if (state.status === "error") {
    return (
      <div role="alert">
        <p>Could not load certifications: {state.message}</p>
        <button type="button" onClick={() => void reload()}>
          Retry
        </button>
      </div>
    );
  }

  const sections = buildCatalog(CATALOG, state.data.certifications);

  return (
    <section className="catalog">
      <h1>Certifications</h1>
      <p className="muted">
        Choose a certification to study. Cards marked WIP are planned and not
        available yet.
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
                    to={`/certifications/${card.id}`}
                  >
                    <span className="cert-vendor">{card.examCode}</span>
                    <span className="cert-name">{card.name}</span>
                    <span className="cert-go" aria-hidden="true">
                      →
                    </span>
                  </Link>
                ) : (
                  <div className="cert-card wip" aria-disabled="true">
                    <span className="cert-vendor">{card.examCode}</span>
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
