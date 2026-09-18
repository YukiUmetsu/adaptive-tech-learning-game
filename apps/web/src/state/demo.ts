import type { CertificationDto, DomainDto } from "../api/types";

/**
 * Whether a catalog entry is demo content.
 *
 * Demo content is authored as a normal (separate) certification bundle, so it is
 * discovered by the entry it declares rather than by a file path.
 */
export function isDemoCertification(certification: CertificationDto): boolean {
  return (
    certification.id.endsWith("-demo") ||
    certification.name.toLowerCase().includes("demo")
  );
}

/** Picks the demo certification from the catalog. */
export function findDemoCertification(
  certifications: CertificationDto[],
): CertificationDto | undefined {
  return certifications.find(isDemoCertification);
}

/** Total authored questions in one domain. */
export function domainQuestionCount(domain: DomainDto): number {
  return domain.tasks.reduce((total, task) => total + task.question_count, 0);
}

/** Total authored questions across every version and domain of a certification. */
export function certificationQuestionCount(
  certification: CertificationDto,
): number {
  return certification.versions.reduce(
    (total, version) =>
      total +
      version.domains.reduce(
        (domainTotal, domain) => domainTotal + domainQuestionCount(domain),
        0,
      ),
    0,
  );
}

/** A demo task flattened with its version and domain for display. */
export interface DemoTask {
  versionId: string;
  domainName: string;
  taskId: string;
  taskName: string;
  questionCount: number;
}

/** Flattens authored demo tasks for display, skipping empty tasks. */
export function demoTasks(certification: CertificationDto): DemoTask[] {
  return certification.versions.flatMap((version) =>
    version.domains.flatMap((domain) =>
      domain.tasks
        .filter((task) => task.question_count > 0)
        .map((task) => ({
          versionId: version.id,
          domainName: domain.name,
          taskId: task.id,
          taskName: task.name,
          questionCount: task.question_count,
        })),
    ),
  );
}
