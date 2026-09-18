import { expect, type Page } from "@playwright/test";

import bundleJson from "../../../content/aws/soa-c03/soa-c03-content-v1.json" with {
  type: "json",
};

interface Choice {
  id: string;
  label: string;
}

interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

type Interaction =
  | { type: "classification"; items: Choice[]; categories: Choice[] }
  | { type: "ordering"; items: Choice[] }
  | { type: "node_connection"; nodes: GraphNode[] };

type CanonicalAnswer =
  | { type: "classification"; placements: Record<string, string> }
  | { type: "ordering"; ordered_ids: string[] }
  | { type: "node_connection"; edges: string[][] };

interface Question {
  id: string;
  interaction: Interaction;
  canonical_answer: CanonicalAnswer;
}

interface ContentBundle {
  version: { domains: Array<{ tasks: Array<{ question_ids: string[] }> }> };
  questions: Question[];
}

// Expectations are derived from the authored bundle so content edits do not
// silently desynchronize the tests.
const content = bundleJson as unknown as ContentBundle;

/** Question ids for SOA-C03 Task 1.1, in mission order. */
export const QUESTION_ORDER: string[] =
  content.version.domains[0].tasks[0].question_ids;

export const TOTAL_QUESTIONS = QUESTION_ORDER.length;

function getQuestion(questionId: string): Question {
  const question = content.questions.find((entry) => entry.id === questionId);
  if (!question) {
    throw new Error(`question ${questionId} is not in the content bundle`);
  }
  return question;
}

function choiceLabel(choices: Choice[], id: string): string {
  const choice = choices.find((entry) => entry.id === id);
  if (!choice) {
    throw new Error(`choice ${id} is not in the content bundle`);
  }
  return choice.label;
}

function nodeLabel(nodes: GraphNode[], id: string): string {
  const node = nodes.find((entry) => entry.id === id);
  if (!node) {
    throw new Error(`node ${id} is not in the content bundle`);
  }
  return node.label;
}

export async function startMission(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "Browse certifications" }).click();
  await expect(
    page.getByRole("heading", { name: "Certifications" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Task 1\.1/ }).click();
  await expect(
    page.getByRole("heading", { name: /Task 1\.1/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(
    page.getByText(new RegExp(`Question 1 of ${TOTAL_QUESTIONS}`)),
  ).toBeVisible();
}

async function placeItems(
  page: Page,
  pairs: Array<[string, string]>,
): Promise<void> {
  for (const [item, category] of pairs) {
    await page.getByRole("button", { name: item, exact: true }).click();
    await page
      .getByRole("group", { name: category, exact: true })
      .getByRole("button", { name: "Place here" })
      .click();
  }
}

async function connectNodes(
  page: Page,
  pairs: Array<[string, string]>,
): Promise<void> {
  for (const [from, to] of pairs) {
    await page.getByRole("button", { name: from, exact: true }).click();
    await page.getByRole("button", { name: to, exact: true }).click();
  }
}

async function orderItems(page: Page, desired: string[]): Promise<void> {
  const list = page.getByRole("list", { name: "Ordered steps" });

  for (let target = 0; target < desired.length; target += 1) {
    const label = desired[target];
    const items = list.getByRole("listitem");
    const count = await items.count();
    let index = -1;

    for (let i = 0; i < count; i += 1) {
      const matches = await items
        .nth(i)
        .getByText(label, { exact: true })
        .count();
      if (matches > 0) {
        index = i;
        break;
      }
    }

    while (index > target) {
      await page
        .getByRole("button", { name: `Move ${label} up`, exact: true })
        .click();
      index -= 1;
    }
  }
}

export async function submitAnswer(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Submit answer" }).click();
}

export async function expectFeedback(
  page: Page,
  heading: "Correct" | "Not quite",
): Promise<void> {
  await expect(
    page.getByTestId("feedback").getByRole("heading", { name: heading }),
  ).toBeVisible();
}

export async function advance(page: Page): Promise<void> {
  const next = page.getByRole("button", { name: "Next question" });
  if ((await next.count()) > 0) {
    await next.click();
    return;
  }
  await page.getByRole("button", { name: "Finish mission" }).click();
}

/** Applies the canonical answer for one question, using no drag. */
export async function answerQuestion(
  page: Page,
  questionId: string,
): Promise<void> {
  const question = getQuestion(questionId);

  if (
    question.interaction.type === "classification" &&
    question.canonical_answer.type === "classification"
  ) {
    const { items, categories } = question.interaction;
    const placements = question.canonical_answer.placements;
    const pairs = items.map(
      (item): [string, string] => [
        item.label,
        choiceLabel(categories, placements[item.id]),
      ],
    );
    await placeItems(page, pairs);
    return;
  }

  if (
    question.interaction.type === "ordering" &&
    question.canonical_answer.type === "ordering"
  ) {
    const items = question.interaction.items;
    const desired = question.canonical_answer.ordered_ids.map((id) =>
      choiceLabel(items, id),
    );
    await orderItems(page, desired);
    return;
  }

  if (
    question.interaction.type === "node_connection" &&
    question.canonical_answer.type === "node_connection"
  ) {
    const nodes = question.interaction.nodes;
    const pairs = question.canonical_answer.edges.map(
      ([from, to]): [string, string] => [
        nodeLabel(nodes, from),
        nodeLabel(nodes, to),
      ],
    );
    await connectNodes(page, pairs);
  }
}

/** Places the first classification item incorrectly and the rest correctly. */
export async function answerFirstClassificationWrong(page: Page): Promise<void> {
  const question = getQuestion(QUESTION_ORDER[0]);
  if (
    question.interaction.type !== "classification" ||
    question.canonical_answer.type !== "classification"
  ) {
    throw new Error("first mission question is not a classification");
  }

  const { items, categories } = question.interaction;
  const placements = question.canonical_answer.placements;
  const first = items[0];
  const wrongCategory = categories.find(
    (category) => category.id !== placements[first.id],
  );
  if (!wrongCategory) {
    throw new Error("classification needs at least two categories");
  }

  const pairs: Array<[string, string]> = [
    [first.label, wrongCategory.label],
    ...items
      .slice(1)
      .map(
        (item): [string, string] => [
          item.label,
          choiceLabel(categories, placements[item.id]),
        ],
      ),
  ];
  await placeItems(page, pairs);
}

/** Answers questions 2..n correctly in mission order. */
export async function answerRemainingCorrectly(page: Page): Promise<void> {
  for (const questionId of QUESTION_ORDER.slice(1)) {
    await answerQuestion(page, questionId);
    await submitAnswer(page);
    await expectFeedback(page, "Correct");
    await advance(page);
  }
}

/** Answers every question correctly in mission order. */
export async function answerMissionCorrectly(page: Page): Promise<void> {
  await answerQuestion(page, QUESTION_ORDER[0]);
  await submitAnswer(page);
  await expectFeedback(page, "Correct");
  await advance(page);

  await answerRemainingCorrectly(page);
}
