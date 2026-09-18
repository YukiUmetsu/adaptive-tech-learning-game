import type { CertificationDto } from "../api/types";

/**
 * Picks the demo certification from the catalog.
 *
 * Demo content is authored as a normal (separate) certification bundle, so the
 * page discovers it by the catalog entry it declares rather than by a file path.
 */
export function findDemoCertification(
  certifications: CertificationDto[],
): CertificationDto | undefined {
  return certifications.find(
    (certification) =>
      certification.id.endsWith("-demo") ||
      certification.name.toLowerCase().includes("demo"),
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
