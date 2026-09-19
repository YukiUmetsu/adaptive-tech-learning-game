import { describe, expect, it } from "vitest";

import { buildKnowledgeGroups } from "./knowledge";

const names = new Map<string, string>([
  ["aws.cloudformation", "AWS CloudFormation"],
  ["aws.cloudformation.changesets", "CloudFormation change sets"],
  ["aws.cloudformation.drift", "CloudFormation drift detection"],
  ["aws.iam", "AWS Identity and Access Management"],
  ["aws.iam.policy_simulator", "IAM policy simulator"],
  ["aws.vpc", "Amazon VPC"],
  ["aws.vpc.endpoints", "VPC endpoints and AWS PrivateLink"],
]);

describe("buildKnowledgeGroups", () => {
  it("groups concepts under a friendly parent and strips vendor prefixes", () => {
    const groups = buildKnowledgeGroups(
      [
        "aws.cloudformation.changesets",
        "aws.cloudformation.drift",
        "aws.iam.policy_simulator",
      ],
      names,
    );

    expect(groups).toEqual([
      {
        id: "aws.cloudformation",
        name: "CloudFormation",
        topics: ["Change sets", "Drift detection"],
      },
      {
        id: "aws.iam",
        name: "Identity and Access Management",
        topics: ["IAM policy simulator"],
      },
    ]);
  });

  it("de-duplicates repeated concepts and preserves first-seen order", () => {
    const groups = buildKnowledgeGroups(
      [
        "aws.vpc.endpoints",
        "aws.vpc.endpoints",
        "aws.cloudformation.drift",
      ],
      names,
    );

    expect(groups.map((group) => group.id)).toEqual([
      "aws.vpc",
      "aws.cloudformation",
    ]);
    expect(groups[0].topics).toEqual(["Endpoints and AWS PrivateLink"]);
  });

  it("never emits a raw concept id, even for concepts missing from the catalog", () => {
    const groups = buildKnowledgeGroups(
      ["aws.autoscaling.target_tracking"],
      new Map(),
    );

    expect(groups).toEqual([
      {
        id: "aws.autoscaling",
        name: "Autoscaling",
        topics: ["Target Tracking"],
      },
    ]);
    // Only display strings matter: the id is never rendered.
    const display = groups.flatMap((group) => [group.name, ...group.topics]);
    expect(display.join(" ")).not.toContain("aws.");
    expect(display.join(" ")).not.toContain("target_tracking");
  });

  it("keeps a standalone concept as its own group with no topics", () => {
    const groups = buildKnowledgeGroups(["aws.cloudformation"], names);

    expect(groups).toEqual([
      { id: "aws.cloudformation", name: "CloudFormation", topics: [] },
    ]);
  });
});
