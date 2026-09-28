/**
 * Operation modifier reference.
 *
 * Ids and names mirror `crates/domain/src/cyber_operation.rs`. The server sends
 * the active modifiers with each generated Operation; this reference supports
 * briefing tooltips and adversary dossier listings.
 */
export interface OperationModifierInfo {
  id: string;
  name: string;
  description: string;
  /** Adversary that can field it. */
  adversaryId: string;
}

export const OPERATION_MODIFIERS: OperationModifierInfo[] = [
  {
    id: "hidden_traffic",
    name: "Hidden Traffic",
    description: "Some traffic is hidden until detection is active.",
    adversaryId: "ghost-7",
  },
  {
    id: "credential_surge",
    name: "Credential Surge",
    description: "More sign-in attempts than usual. MFA and rate limiting help.",
    adversaryId: "ghost-7",
  },
  {
    id: "identity_pressure",
    name: "Identity Pressure",
    description: "Identity attacks are tougher. MFA is the reliable counter.",
    adversaryId: "ghost-7",
  },
  {
    id: "mixed_vector",
    name: "Mixed Vector",
    description: "A second attack family joins the assault.",
    adversaryId: "null",
  },
  {
    id: "strict_latency",
    name: "Strict Latency",
    description: "The latency target is tighter. Every extra control adds delay.",
    adversaryId: "null",
  },
  {
    id: "application_pressure",
    name: "Application Pressure",
    description: "Application attacks are tougher. Input validation and WAF help.",
    adversaryId: "null",
  },
  {
    id: "recovery_pressure",
    name: "Recovery Pressure",
    description: "There is less margin for error. Backup limits the impact.",
    adversaryId: "viper",
  },
  {
    id: "hardened_campaign",
    name: "Hardened Campaign",
    description: "Every attack is more resilient. Layered controls matter.",
    adversaryId: "viper",
  },
  {
    id: "delayed_impact",
    name: "Delayed Impact",
    description: "Slower but far tougher attacks. Do not let them pile up.",
    adversaryId: "viper",
  },
];

export const OPERATION_MODIFIERS_BY_ID: Record<string, OperationModifierInfo> =
  Object.fromEntries(
    OPERATION_MODIFIERS.map((modifier) => [modifier.id, modifier]),
  );
