import type { CertificationDto } from "../api/types";

/**
 * Frontend catalog metadata: which certifications to show, grouped by category.
 *
 * The API remains the source of truth for which certifications actually have
 * content. A metadata entry whose `id` matches an API certification is
 * AVAILABLE; otherwise it is a muted WIP card. Adding a planned certification is
 * a single entry here, not a new component.
 */
export interface PlannedCertification {
  /** Stable key. Matches an API certification id when the content exists. */
  id: string;
  /** Display name used before content exists. */
  name: string;
  /** Display exam code used before content exists. */
  examCode: string;
  /** Marks a planned certification that has no content yet. */
  wip: boolean;
}

export interface CatalogCategory {
  id: string;
  label: string;
  certifications: PlannedCertification[];
}

export const CATALOG: CatalogCategory[] = [
  {
    id: "ai",
    label: "AI & Machine Learning",
    certifications: [
      {
        id: "ai-python-fluency",
        name: "Python Fluency",
        examCode: "PYTHON-FLUENCY",
        wip: false,
      },
      {
        id: "python-data-stack",
        name: "Python Data Stack: NumPy, pandas, Matplotlib & Seaborn",
        examCode: "PY-DATA-STACK",
        wip: false,
      },
      {
        id: "ai-pytorch-core",
        name: "PyTorch Core: Practical ML & Neural Networks",
        examCode: "PYTORCH-CORE",
        wip: false,
      },
    ],
  },
  {
    id: "aws",
    label: "AWS",
    certifications: [
      {
        id: "aws-soa-c03",
        name: "AWS Certified CloudOps Engineer - Associate",
        examCode: "SOA-C03",
        wip: false,
      },
      {
        id: "aws-aip-c01",
        name: "AWS Certified Generative AI Developer - Professional",
        examCode: "AIP-C01",
        wip: false,
      },
      {
        id: "aws-saa-c03",
        name: "AWS Certified Solutions Architect - Associate",
        examCode: "SAA-C03",
        wip: false,
      },
    ],
  },
  {
    id: "azure",
    label: "Microsoft Azure",
    certifications: [
      {
        id: "azure-az-104",
        name: "Microsoft Azure Administrator",
        examCode: "AZ-104",
        wip: true,
      },
    ],
  },
  {
    id: "gcp",
    label: "Google Cloud",
    certifications: [
      {
        id: "gcp-ace",
        name: "Google Associate Cloud Engineer",
        examCode: "ACE",
        wip: true,
      },
    ],
  },
  {
    id: "security",
    label: "Security",
    certifications: [
      {
        id: "comptia-security-plus",
        name: "CompTIA Security+",
        examCode: "SY0-701",
        wip: true,
      },
    ],
  },
];

export interface CatalogCard {
  id: string;
  name: string;
  examCode: string;
  available: boolean;
  certification?: CertificationDto;
}

export interface CatalogSection {
  id: string;
  label: string;
  cards: CatalogCard[];
}

/** Joins the planned metadata with the API catalog. */
export function buildCatalog(
  categories: CatalogCategory[],
  certifications: CertificationDto[],
): CatalogSection[] {
  const byId = new Map(
    certifications.map((certification) => [certification.id, certification]),
  );

  return categories.map((category) => ({
    id: category.id,
    label: category.label,
    cards: category.certifications.map((entry) => {
      const certification = byId.get(entry.id);
      return {
        id: entry.id,
        name: certification?.name ?? entry.name,
        examCode: certification?.exam_code ?? entry.examCode,
        available: Boolean(certification) && !entry.wip,
        certification,
      };
    }),
  }));
}
