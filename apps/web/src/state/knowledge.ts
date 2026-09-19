/**
 * Learner-facing knowledge grouping.
 *
 * Missions carry raw concept ids such as `aws.cloudformation.changesets`.
 * Learners should never see those ids. This module maps them to the names
 * authored in the certification catalog and groups related concepts under a
 * friendly parent (for example CloudFormation -> Change sets, Drift).
 */
export interface KnowledgeGroup {
  /** Stable key for React and tests. */
  id: string;
  /** Friendly group/service name. Never a raw identifier. */
  name: string;
  /** Friendly names of the specific topics practiced in this group. */
  topics: string[];
}

/** Concept id to learner-facing name. */
export type ConceptNames = ReadonlyMap<string, string>;

// Tokens that should stay upper-case when an id has to be humanized because the
// catalog has not loaded (or a concept is missing from it).
const ACRONYMS = new Set([
  "aws",
  "ami",
  "api",
  "arn",
  "asg",
  "cdk",
  "cli",
  "cpu",
  "dns",
  "ebs",
  "ec2",
  "efs",
  "fsx",
  "http",
  "https",
  "iam",
  "json",
  "kms",
  "nacl",
  "nlb",
  "rds",
  "rpo",
  "rto",
  "s3",
  "sdk",
  "sns",
  "sqs",
  "ssl",
  "tls",
  "vpc",
  "waf",
  "yaml",
]);

function humanizeIdentifier(identifier: string): string {
  const words = identifier.split(/[._-]+/).filter(Boolean);
  return words
    .map((word) => {
      if (ACRONYMS.has(word.toLowerCase())) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function stripVendor(name: string): string {
  return name
    .replace(/^(aws|amazon|microsoft|azure|google cloud|google)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Longest known ancestor of a concept id, falling back to its service root. */
function groupKeyFor(conceptId: string, names: ConceptNames): string {
  const parts = conceptId.split(".").filter(Boolean);
  for (let size = parts.length - 1; size >= 2; size -= 1) {
    const prefix = parts.slice(0, size).join(".");
    if (names.has(prefix)) {
      return prefix;
    }
  }
  if (parts.length >= 3) {
    return parts.slice(0, 2).join(".");
  }
  return conceptId;
}

function groupNameFor(key: string, names: ConceptNames): string {
  const named = names.get(key);
  if (named) {
    return stripVendor(named);
  }
  const parts = key.split(".").filter(Boolean);
  return humanizeIdentifier(parts[parts.length - 1] ?? key);
}

function topicNameFor(
  conceptId: string,
  groupName: string,
  names: ConceptNames,
): string {
  const named = names.get(conceptId);
  let label = named
    ? stripVendor(named)
    : humanizeIdentifier(conceptId.split(".").pop() ?? conceptId);

  if (groupName && label.toLowerCase().startsWith(groupName.toLowerCase())) {
    label = label.slice(groupName.length).replace(/^[\s:–—-]+/, "");
  }
  if (!label) {
    label = named ?? humanizeIdentifier(conceptId);
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Builds display groups from concept evidence, de-duplicating and preserving
 * first-seen order.
 */
export function buildKnowledgeGroups(
  conceptIds: string[],
  names: ConceptNames,
): KnowledgeGroup[] {
  const groups = new Map<string, KnowledgeGroup>();
  const seen = new Set<string>();

  for (const conceptId of conceptIds) {
    if (seen.has(conceptId)) {
      continue;
    }
    seen.add(conceptId);

    const key = groupKeyFor(conceptId, names);
    const name = groupNameFor(key, names);
    const group = groups.get(key) ?? { id: key, name, topics: [] };

    if (conceptId !== key) {
      const topic = topicNameFor(conceptId, name, names);
      if (!group.topics.includes(topic)) {
        group.topics.push(topic);
      }
    }

    groups.set(key, group);
  }

  return [...groups.values()];
}
