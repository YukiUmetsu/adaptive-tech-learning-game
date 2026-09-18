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
  startMission,
  submitAnswer,
} from "./helpers";

test("E2E 1 — basic learning journey", async ({ page }) => {
  await startMission(page);
  await expect(page.getByTestId("mission-header")).toMatchAriaSnapshot();

  await answerMissionCorrectly(page);

  await expect(
    page.getByRole("heading", { name: "Mission summary" }),
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
  await expect(page.getByTestId("feedback")).toMatchAriaSnapshot();
  await expect(
    page.getByText(/Metrics are numeric time series used for trends/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Try again" }).click();
  await answerQuestion(page, QUESTION_ORDER[0]);
  await submitAnswer(page);
  await expectFeedback(page, "Correct");
  await advance(page);

  await answerRemainingCorrectly(page);

  await expect(
    page.getByRole("heading", { name: "Mission summary" }),
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

  // The first three questions are classification, ordering, and connection.
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
  await page.getByRole("button", { name: "Retry sync" }).click();

  await expect(page.getByText("All learning events synced.")).toBeVisible();
});

test("E2E 6 — dragging from a node does not move it and creates a connection", async ({
  page,
}) => {
  await startMission(page);

  // Advance to the first node-connection question.
  for (const questionId of QUESTION_ORDER.slice(0, 2)) {
    await answerQuestion(page, questionId);
    await submitAnswer(page);
    await expectFeedback(page, "Correct");
    await advance(page);
  }

  const source = page.getByRole("button", {
    name: "CloudWatch alarm",
    exact: true,
  });
  const target = page.getByRole("button", { name: "SNS topic", exact: true });

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

  const connections = page.getByRole("list", { name: "Connections" });
  await expect(connections).toContainText("CloudWatch alarm");
  await expect(connections).toContainText("SNS topic");
});
