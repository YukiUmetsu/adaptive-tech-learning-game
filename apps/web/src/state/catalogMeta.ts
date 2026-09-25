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
  /**
   * Compact name for space-constrained surfaces such as the navbar dropdown,
   * where the category heading already supplies the vendor. Authored
   * explicitly so the UI never strips vendor words with fragile matching.
   */
  shortName?: string;
  /** Display exam code used before content exists. */
  examCode: string;
  /** Marks a planned certification that has no content yet. */
  wip: boolean;
}

/**
 * Whether a group holds vendor certifications or general learning tracks.
 *
 * Authored explicitly so the UI never infers it from names or vendors.
 */
export type TrackKind = "certification" | "track";

export interface CatalogCategory {
  id: string;
  label: string;
  /** Selects the display order: certifications before other tracks. */
  kind: TrackKind;
  certifications: PlannedCertification[];
}

/** Certifications are listed before non-certification learning tracks. */
const KIND_ORDER: Record<TrackKind, number> = {
  certification: 0,
  track: 1,
};

/** Stable-orders groups by kind, preserving authored order within a kind. */
function orderByKind(categories: CatalogCategory[]): CatalogCategory[] {
  return categories
    .map((category, index) => ({ category, index }))
    .sort(
      (a, b) =>
        KIND_ORDER[a.category.kind] - KIND_ORDER[b.category.kind] ||
        a.index - b.index,
    )
    .map(({ category }) => category);
}

export const CATALOG: CatalogCategory[] = [
  {
    id: "aws",
    label: "AWS",
    kind: "certification",
    certifications: [
      {
        id: "aws-soa-c03",
        name: "AWS Certified CloudOps Engineer - Associate",
        shortName: "CloudOps Engineer - Associate",
        examCode: "SOA-C03",
        wip: false,
      },
      {
        id: "aws-aip-c01",
        name: "AWS Certified Generative AI Developer - Professional",
        shortName: "Generative AI Developer - Professional",
        examCode: "AIP-C01",
        wip: false,
      },
      {
        id: "aws-saa-c03",
        name: "AWS Certified Solutions Architect - Associate",
        shortName: "Solutions Architect - Associate",
        examCode: "SAA-C03",
        wip: false,
      },
    ],
  },
  {
    id: "hashicorp",
    label: "HashiCorp",
    kind: "certification",
    certifications: [
      {
        id: "hashicorp-terraform-associate-004",
        name: "HashiCorp Certified: Terraform Associate",
        shortName: "Terraform Associate",
        examCode: "HCTA0-004",
        wip: false,
      },
    ],
  },
  {
    id: "azure",
    label: "Microsoft Azure",
    kind: "certification",
    certifications: [
      {
        id: "microsoft-az-900",
        name: "Microsoft Certified: Azure Fundamentals",
        // The "Microsoft Azure" category label already names the vendor, so the
        // compact navbar label drops "Microsoft Certified:".
        shortName: "Azure Fundamentals",
        examCode: "AZ-900",
        wip: false,
      },
    ],
  },
  {
    id: "gcp",
    label: "Google Cloud",
    kind: "certification",
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
    kind: "certification",
    certifications: [
      {
        id: "comptia-security-plus",
        name: "CompTIA Security+",
        // The "Security" category label supplies no vendor, so the compact
        // navbar label keeps "CompTIA" rather than dropping it like AWS does.
        shortName: "CompTIA Security+",
        examCode: "SY0-701",
        wip: false,
      },
    ],
  },
  {
    id: "ai",
    label: "AI & Machine Learning",
    kind: "track",
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
];

export interface CatalogCard {
  id: string;
  name: string;
  /** Compact name for space-constrained surfaces; falls back to `name`. */
  shortName: string;
  examCode: string;
  available: boolean;
  certification?: CertificationDto;
}

/** A navigable learning track, as shown in the navbar dropdown. */
export interface TrackLink {
  id: string;
  name: string;
  /** Compact label for the dropdown; falls back to `name`. */
  shortName: string;
  examCode: string;
  /**
   * Whether this is a vendor certification. Only certifications show their
   * exam-code tag, since it is meaningful there.
   */
  certification: boolean;
}

/** Available learning tracks for one catalog category. */
export interface TrackGroup {
  id: string;
  label: string;
  kind: TrackKind;
  tracks: TrackLink[];
}

export interface CatalogSection {
  id: string;
  label: string;
  /** Whether this section holds vendor certifications or other tracks. */
  kind: TrackKind;
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

  return orderByKind(categories).map((category) => ({
    id: category.id,
    label: category.label,
    kind: category.kind,
    cards: category.certifications.map((entry) => {
      const certification = byId.get(entry.id);
      const name = certification?.name ?? entry.name;
      return {
        id: entry.id,
        name,
        // Compact label for tight surfaces; the full name when none is authored.
        shortName: entry.shortName ?? name,
        examCode: certification?.exam_code ?? entry.examCode,
        available: Boolean(certification) && !entry.wip,
        certification,
      };
    }),
  }));
}

/**
 * Selects the available learning tracks grouped by category, reusing the same
 * catalog join as the Learning Tracks page so the navbar and the page never
 * drift. Planned/WIP entries are omitted: the navbar only links to real tracks.
 */
export function selectTrackGroups(
  categories: CatalogCategory[],
  certifications: CertificationDto[],
): TrackGroup[] {
  return buildCatalog(categories, certifications)
    .map((section) => ({
      id: section.id,
      label: section.label,
      kind: section.kind,
      tracks: section.cards
        .filter((card) => card.available)
        .map((card) => ({
          id: card.id,
          name: card.name,
          shortName: card.shortName,
          examCode: card.examCode,
          certification: section.kind === "certification",
        })),
    }))
    .filter((group) => group.tracks.length > 0);
}
