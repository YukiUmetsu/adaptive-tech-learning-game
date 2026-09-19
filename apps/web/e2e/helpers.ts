import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";

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
  certification: { id: string };
  version: {
    domains: Array<{
      id: string;
      tasks: Array<{ id: string; question_ids: string[] }>;
    }>;
  };
  questions: Question[];
}

// Load every content bundle from the repository `content/` tree instead of
// hardcoding a file path, so adding a certification/version needs no test edit.
function collectBundles(directory: string): ContentBundle[] {
  const bundles: ContentBundle[] = [];
  // Sort entries so discovery order is deterministic across filesystems and
  // matches the Rust build-time embedding order.
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      bundles.push(...collectBundles(path));
    } else if (entry.name.endsWith(".json")) {
      bundles.push(JSON.parse(readFileSync(path, "utf8")) as ContentBundle);
    }
  }
  return bundles;
}

const contentRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../content",
);

function loadAuthoredBundle(): ContentBundle {
  const bundles = collectBundles(contentRoot);
  const first = bundles.find((bundle) =>
    bundle.version.domains.some((domain) =>
      domain.tasks.some((task) => task.question_ids.length > 0),
    ),
  );
  if (!first) {
    throw new Error(`no authored content bundle found under ${contentRoot}`);
  }

  // Mirror the API registry: bundles sharing a certification id are merged, with
  // later files overriding duplicate questions and task definitions.
  const certificationId = first.certification.id;
  const merged: ContentBundle = {
    certification: first.certification,
    version: {
      domains: first.version.domains.map((domain) => ({
        ...domain,
        tasks: domain.tasks.map((task) => ({ ...task })),
      })),
    },
    questions: [...first.questions],
  };

  for (const bundle of bundles) {
    if (bundle === first || bundle.certification.id !== certificationId) {
      continue;
    }
    for (const question of bundle.questions) {
      const index = merged.questions.findIndex((entry) => entry.id === question.id);
      if (index >= 0) {
        merged.questions[index] = question;
      } else {
        merged.questions.push(question);
      }
    }
    for (const domain of bundle.version.domains) {
      const target = merged.version.domains.find((entry) => entry.id === domain.id);
      if (!target) {
        merged.version.domains.push(domain);
        continue;
      }
      for (const task of domain.tasks) {
        const taskIndex = target.tasks.findIndex((entry) => entry.id === task.id);
        if (taskIndex >= 0) {
          if (task.question_ids.length > 0) {
            target.tasks[taskIndex] = task;
          }
        } else {
          target.tasks.push(task);
        }
      }
    }
  }

  return merged;
}

const content = loadAuthoredBundle();

function authoredQuestionIds(bundle: ContentBundle): string[] {
  for (const domain of bundle.version.domains) {
    for (const task of domain.tasks) {
      if (task.question_ids.length > 0) {
        return task.question_ids;
      }
    }
  }
  throw new Error(`no authored task found under ${contentRoot}`);
}

/** Question ids for the authored task, in mission order. */
export const QUESTION_ORDER: string[] = authoredQuestionIds(content);

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

export async function signInAsDevUser(page: Page): Promise<void> {
  // E2E runs the API in `test` mode without WorkOS credentials, and the web dev
  // server exposes the matching local developer sign-in. Sign in so scored
  // missions are owned by an account rather than treated as anonymous.
  await page.goto("/login?returnTo=%2F");
  const button = page.getByRole("button", {
    name: "Continue as local developer",
  });
  await expect(button).toBeVisible();
  await button.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export async function startMission(page: Page): Promise<void> {
  // Task Practice remains available for the demo/internal flow, so the E2E
  // suite drives it directly rather than through the new dashboard modes.
  await signInAsDevUser(page);

  const certificationId = content.certification.id;
  const taskId = firstAuthoredTaskId(content);

  await page.goto(`/tracks/${certificationId}/tasks/${taskId}`);
  await expect(
    page.getByRole("heading", { name: new RegExp(`Task ${taskId}`) }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(
    page.getByText(new RegExp(`Question 1 of ${TOTAL_QUESTIONS}`)),
  ).toBeVisible();
}

function firstAuthoredTaskId(bundle: ContentBundle): string {
  for (const domain of bundle.version.domains) {
    for (const task of domain.tasks) {
      if (task.question_ids.length > 0) {
        return task.id;
      }
    }
  }
  throw new Error("no authored task found");
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
