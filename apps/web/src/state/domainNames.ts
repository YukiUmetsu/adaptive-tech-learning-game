/**
 * Short, game-friendly domain names.
 *
 * Authored domain names are precise but long. The map and switcher need short
 * labels so they stay readable and calm; the full name is still available in
 * accessible labels and detail panels. This is display-only and never changes
 * content or identity.
 */

/** Exact authored names mapped to a short label. */
const EXACT: Record<string, string> = {
  "Monitoring, Logging, Analysis, Remediation, and Performance Optimization":
    "Observability",
  "Deployment, Provisioning, and Automation": "Automation",
  "Design Cost-Optimized Architectures": "Cost Optimization",
  "Design High-Performing Architectures": "Performance",
  "Design Resilient Architectures": "Resilience",
  "Design Secure Architectures": "Security",
  "Foundation Model Integration, Data Management, and Compliance":
    "Foundation Models",
  "Operational Efficiency and Optimization for Generative AI Applications":
    "Operations",
  "Reliability and Business Continuity": "Reliability",
  "Networking and Content Delivery": "Networking",
  "Security and Compliance": "Security",
  "AI Safety, Security, and Governance": "AI Safety",
  "Matplotlib: Plot Selection & Object-Oriented Plotting": "Matplotlib",
  "NumPy: Arrays, Shapes, Axes & Vectorized Computation": "NumPy",
  "pandas: Data Selection, Transformation & Analysis": "pandas",
  "Seaborn: Statistical Visualization & Semantic Mapping": "Seaborn",
  "Autograd & Training Loops": "Autograd",
  "Losses, Optimizers & Learning-Rate Control": "Optimizers",
  "Models & Common Neural Network Layers": "Neural Networks",
  "Devices, Checkpoints & Performance": "Checkpoints",
  "Datasets & Data Pipelines": "Data Pipelines",
  "Tensor Fundamentals & Shape Fluency": "Tensors",
  "Threads, Processes & Parallel Work": "Concurrency",
  "Asyncio & Structured Concurrency": "Asyncio",
  "Iteration, Comprehensions & Unpacking": "Iteration",
  "Functions, Objects & Practical Syntax": "Functions",
  "Mappings, Collections & Built-ins": "Collections",
  "Practical Standard Library": "Std Library",
  "Testing, Validation, and Troubleshooting": "Testing",
  "Infrastructure as Code (IaC) with Terraform": "IaC",
  "Maintain infrastructure with Terraform": "Maintenance",
  "Terraform configuration": "Configuration",
  "Terraform fundamentals": "Fundamentals",
  "Terraform modules": "Modules",
  "Terraform state management": "State",
  "Core Terraform workflow": "Workflow",
  "Implementation and Integration": "Integration",
};

/** Longest short label before the generic fallback trims words. */
const MAX_LENGTH = 18;

/**
 * Returns a short, readable label for a domain name.
 *
 * Known names use a curated alias; otherwise the text before the first comma is
 * used, trimmed to a few words when still long.
 */
export function shortDomainName(name: string): string {
  const trimmed = name.trim();
  const exact = EXACT[trimmed];
  if (exact) {
    return exact;
  }

  const firstSegment = trimmed.split(",")[0].trim();
  if (firstSegment.length <= MAX_LENGTH) {
    return firstSegment;
  }

  const words = firstSegment.split(/\s+/);
  let short = "";
  for (const word of words) {
    const next = short ? `${short} ${word}` : word;
    if (next.length > MAX_LENGTH) {
      break;
    }
    short = next;
  }
  return short || firstSegment.slice(0, MAX_LENGTH);
}
