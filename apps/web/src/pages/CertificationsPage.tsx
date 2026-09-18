import { Link } from "react-router-dom";

import { useCatalog } from "../hooks/useCatalog";
import {
  certificationQuestionCount,
  domainQuestionCount,
  isDemoCertification,
} from "../state/demo";

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

  // Demo content has its own page, so it is excluded here.
  const certifications = state.data.certifications.filter(
    (certification) => !isDemoCertification(certification),
  );

  return (
    <section>
      <h1>Certifications</h1>
      {certifications.length === 0 ? (
        <p className="muted">No certifications are available yet.</p>
      ) : null}

      {certifications.map((certification) => (
        <article key={certification.id} className="certification">
          <h2>{certification.name}</h2>
          <p className="muted">
            {certification.vendor} · {certification.exam_code} ·{" "}
            {certificationQuestionCount(certification)} questions · reviewed{" "}
            {certification.last_reviewed}
          </p>
          <p>
            <a
              href={certification.official_source_url}
              target="_blank"
              rel="noreferrer"
            >
              Official exam guide
            </a>
          </p>

          {certification.versions.map((version) => (
            <div key={version.id}>
              <h3>
                {version.id}{" "}
                <span className="muted">content {version.content_version}</span>
              </h3>
              <ul className="domain-list">
                {version.domains.map((domain) => (
                  <li key={domain.id}>
                    <strong>{domain.name}</strong>{" "}
                    <span className="domain-weight">
                      {Math.round(domain.weight * 100)}%
                    </span>{" "}
                    <span className="muted">
                      · {domainQuestionCount(domain)} questions
                    </span>
                    {domain.tasks.length > 0 ? (
                      <ul>
                        {domain.tasks.map((task) => (
                          <li key={task.id}>
                            <Link
                              to={`/certifications/${certification.id}/tasks/${task.id}`}
                            >
                              Task {task.id}: {task.name}
                            </Link>{" "}
                            <span className="muted">
                              ({task.question_count} questions)
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted"> — not yet authored</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </article>
      ))}
    </section>
  );
}
