import { expect, test } from "@playwright/test";

import {
  QUESTION_ORDER,
  TOTAL_QUESTIONS,
  advance,
  answerFirstClassificationWrong,
  answerMissionCorrectly,
  answerQuestion,
  answerRemainingCorrectly,
  expectFeedback,
  firstTaskWithInteraction,
  nodeConnectionDragIndices,
  questionExplanation,
  startMission,
  startMissionForTask,
  submitAnswer,
} from "./helpers";

test("E2E 1 — basic learning journey", async ({ page }) => {
  await startMission(page);
  await expect(page.getByTestId("mission-header")).toContainText(
    `Question 1 of ${TOTAL_QUESTIONS}`,
  );

  await answerMissionCorrectly(page);

  await expect(
    page.getByRole("heading", { name: "Mission Complete" }),
  ).toBeVisible();
  await expect(page.getByTestId("summary-completed")).toHaveText(
    `${TOTAL_QUESTIONS} / ${TOTAL_QUESTIONS}`,
  );
  await expect(page.getByTestId("summary-first-attempt")).toHaveText(
    String(TOTAL_QUESTIONS),
  );
  await expect(page.getByTestId("summary-recovered")).toHaveText("0");
  await expect(page.getByTestId("summary-pending")).toHaveCount(0);
});

test("E2E 2 — incorrect attempt, explanation, and recovery", async ({
  page,
}) => {
  await startMission(page);

  await answerFirstClassificationWrong(page);
  await submitAnswer(page);

  await expectFeedback(page, "Not quite");
  const feedback = page.getByTestId("feedback");
  await expect(feedback).toBeVisible();
  // The panel explains the mismatch using the authored explanation for Q1.
  const explanation = questionExplanation(QUESTION_ORDER[0]).replace(/`/g, "");
  await expect(feedback).toContainText(explanation.slice(0, 60));

  await page.getByRole("button", { name: "Try again" }).click();
  await answerQuestion(page, QUESTION_ORDER[0]);
  await submitAnswer(page);
  await expectFeedback(page, "Correct");
  await advance(page);

  await answerRemainingCorrectly(page);

  await expect(
    page.getByRole("heading", { name: "Mission Complete" }),
  ).toBeVisible();
  // The recovered question must not be reported as first-attempt success.
  await expect(page.getByTestId("summary-first-attempt")).toHaveText(
    String(TOTAL_QUESTIONS - 1),
  );
  await expect(page.getByTestId("summary-recovered")).toHaveText("1");
});

test("E2E 3 — refresh resumes the mission", async ({ page }) => {
  await startMission(page);

  await answerQuestion(page, QUESTION_ORDER[0]);
  await submitAnswer(page);
  await expectFeedback(page, "Correct");
  await advance(page);
  await expect(page.getByText(/Question 2 of /)).toBeVisible();

  await page.reload();

  await expect(page.getByText(/Question 2 of /)).toBeVisible();
});

test("E2E 4 — accessible non-drag interactions", async ({ page }) => {
  await startMission(page);

  // Answer the first three authored questions without any drag: the content
  // mixes classification and typed-fill puzzles, and every one has a tap/type
  // equivalent.
  for (const questionId of QUESTION_ORDER.slice(0, 3)) {
    await answerQuestion(page, questionId);
    await submitAnswer(page);
    await expectFeedback(page, "Correct");
    await advance(page);
  }
});

test("E2E 5 — unsynced events stay pending until sync succeeds", async ({
  page,
}) => {
  await page.route("**/v1/sync", (route) => route.abort());

  await startMission(page);
  await answerMissionCorrectly(page);

  await expect(page.getByTestId("summary-pending")).toContainText(
    "waiting to sync",
  );

  await page.unroute("**/v1/sync");
  await page.getByRole("button", { name: "Retry Sync" }).click();

  await expect(page.getByText(/Progress saved/)).toBeVisible();
});

test("E2E 6 — dragging from a node does not move it and creates a connection", async ({
  page,
}) => {
  const task = firstTaskWithInteraction("node_connection");
  test.skip(!task, "no node-connection question is authored");
  await startMissionForTask(page, task!);

  const { from, to } = nodeConnectionDragIndices(task!);
  const nodeButtons = page.locator(".graph-node");
  const source = nodeButtons.nth(from);
  const target = nodeButtons.nth(to);

  const before = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(before).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(
    before!.x + before!.width / 2,
    before!.y + before!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
    { steps: 12 },
  );
  const during = await source.boundingBox();
  await page.mouse.up();

  // The source node must stay anchored while dragging.
  expect(during).not.toBeNull();
  expect(Math.abs(during!.x - before!.x)).toBeLessThan(1);
  expect(Math.abs(during!.y - before!.y)).toBeLessThan(1);

  // A real connection (with a remove control) is created, not the empty state.
  const connections = page.getByRole("list", { name: "Connections" });
  await expect(
    connections.getByRole("button", { name: /Remove connection/i }),
  ).toBeVisible();
});
