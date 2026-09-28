import {
  expect,
  test,
  type APIRequestContext,
} from "@playwright/test";

import { signInAsDevUser } from "./helpers";

/**
 * Questions: the exam-simulation practice-test surface.
 *
 * The authored practice test is fixed and timed, so this drives the question
 * experience itself: start the exam, use the question navigator, mark an item,
 * submit behind a confirmation, and read the results/review. The practice test
 * is discovered through the public API rather than hardcoded, so content
 * updates do not break the spec.
 */

const API_PORT = process.env.E2E_API_PORT ?? "8080";
const API_BASE = `http://127.0.0.1:${API_PORT}`;

interface PracticeTestSummary {
  id: string;
  title: string;
}

interface PracticeTestListResponse {
  practice_tests?: PracticeTestSummary[];
}

interface CatalogResponse {
  certifications?: Array<{ id: string }>;
}

/** Finds the first certification that authors a practice test. */
async function findPracticeTest(
  request: APIRequestContext,
): Promise<{ certificationId: string; test: PracticeTestSummary } | null> {
  const catalogResponse = await request.get(`${API_BASE}/v1/certifications`);
  if (!catalogResponse.ok()) {
    return null;
  }
  const catalog = (await catalogResponse.json()) as CatalogResponse;

  for (const certification of catalog.certifications ?? []) {
    const listResponse = await request.get(
      `${API_BASE}/v1/certifications/${certification.id}/practice-tests`,
    );
    if (!listResponse.ok()) {
      continue;
    }
    const list = (await listResponse.json()) as PracticeTestListResponse;
    const test = list.practice_tests?.[0];
    if (test) {
      return { certificationId: certification.id, test };
    }
  }
  return null;
}

test("questions: practice test navigator, submit, and review", async ({
  page,
  request,
}) => {
  await signInAsDevUser(page);

  const found = await findPracticeTest(request);
  test.skip(!found, "no practice test is authored");
  const { certificationId, test: practiceTest } = found!;

  await page.goto(
    `/tracks/${certificationId}/practice-tests/${practiceTest.id}`,
  );

  // Exam start screen.
  await expect(
    page.getByRole("heading", { name: practiceTest.title }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start practice test" }).click();

  // First question and the running timer.
  await expect(page.getByText(/Question 1 of \d+/)).toBeVisible();
  await expect(page.getByTestId("practice-test-timer")).toBeVisible();

  // The navigator shows per-question status.
  await page.getByRole("button", { name: "All questions" }).click();
  const navigator = page.getByRole("navigation", {
    name: "Question navigator",
  });
  await expect(navigator).toBeVisible();
  await expect(
    navigator.getByRole("button", { name: /Question 1, unanswered, current/ }),
  ).toBeVisible();

  // Mark for review, then jump to the next question.
  await page.getByRole("button", { name: "Mark for review" }).click();
  await expect(
    navigator.getByRole("button", { name: /Question 1, marked, current/ }),
  ).toBeVisible();
  await navigator.getByRole("button", { name: /Question 2, unanswered/ }).click();
  await expect(page.getByText(/Question 2 of \d+/)).toBeVisible();

  // Submitting asks for confirmation, then shows the scored review.
  await page.getByRole("button", { name: "Submit test" }).click();
  const dialog = page.getByRole("dialog", { name: "Submit practice test" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Submit test" }).click();

  await expect(page.getByText(/Practice score:/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Question review" }),
  ).toBeVisible();
});
