/**
 * Short technical intel for each attack family.
 *
 * Shown when a player taps an incoming threat in an Operation briefing. The
 * explanations and defences reflect established guidance (OWASP, NIST, CIS,
 * MITRE ATT&CK) and never overstate a control: a WAF reduces SQL injection but
 * does not fix it, backup is recovery rather than prevention, and least
 * privilege limits blast radius rather than blocking initial access.
 */

export interface AttackIntel {
  /** One or two sentences on how the attack actually works. */
  summary: string;
  /** How to prevent it, or protect resources from it, strongest first. */
  defences: string[];
}

export const ATTACK_INTEL: Record<string, AttackIntel> = {
  ddos_swarm: {
    summary:
      "A flood of junk requests from many sources tries to exhaust bandwidth, connections, or CPU so legitimate users cannot get through.",
    defences: [
      "Rate limiting and connection caps at the edge",
      "A scrubbing/blocking layer sized for the traffic volume",
      "CDN or anycast absorption to spread the flood",
      "Monitoring to catch abnormal traffic early",
    ],
  },
  botnet_ddos_boss: {
    summary:
      "A coordinated botnet of compromised machines sustains a large volumetric flood and keeps summoning more junk traffic.",
    defences: [
      "Edge rate limiting plus a scrubbing layer sized for the flood",
      "CDN or anycast absorption and upstream provider filtering",
      "Traffic analysis to separate bots from real users",
      "A rehearsed incident-response plan for sustained attacks",
    ],
  },
  sql_injection: {
    summary:
      "Untrusted input is concatenated into a SQL query, so an attacker can change the query's logic and read or alter the database.",
    defences: [
      "Parameterized queries / prepared statements — the root-cause fix",
      "Input validation as defense in depth",
      "A WAF reduces attempts but does not fix the vulnerable query",
      "Least privilege limits what a successful injection can reach",
    ],
  },
  xss: {
    summary:
      "Attacker-controlled content is rendered as script in another user's browser, letting the attacker act as that user or steal data.",
    defences: [
      "Context-aware output encoding — the primary fix",
      "A Content Security Policy to block inline and unknown scripts",
      "Safe templating and input validation",
      "A WAF reduces known payloads but is not a complete fix",
    ],
  },
  credential_stuffing: {
    summary:
      "Username and password pairs leaked from other breaches are replayed at scale, betting that people reuse passwords.",
    defences: [
      "MFA — a stolen password alone no longer works",
      "Rate limiting and bot detection slow the attempts",
      "Breached-password checks and lockouts",
      "Monitoring for many-account or impossible-travel patterns",
    ],
  },
  ransomware: {
    summary:
      "Malware encrypts data and demands payment, usually after an initial foothold and lateral movement across the network.",
    defences: [
      "Least privilege limits how far it can spread",
      "Offline or immutable backups let you recover without paying",
      "Segmentation limits lateral movement",
      "Monitoring/EDR to detect encryption behaviour early",
    ],
  },
};

/** Intel for an attack id, falling back to `undefined` for unknown ids. */
export function attackIntel(attackId: string): AttackIntel | undefined {
  return ATTACK_INTEL[attackId];
}
