import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PracticeTestItemResult,
  PracticeTestResponse,
  PracticeTestResultResponse,
} from "../api/types";
import { saveAttempt, startAttempt } from "../state/practiceTest";
import PracticeTestPage from "./PracticeTestPage";

const choices = [
  { id: "A", label: "Option alpha" },
  { id: "B", label: "Option bravo" },
  { id: "C", label: "Option charlie" },
  { id: "D", label: "Option delta" },
];

const practiceTest = {
  id: "aws-soa-c03-practice-test-1",
  title: "SOA-C03 Practice Test 1",
  exam_code: "SOA-C03",
  certification_version: "soa-c03",
  content_version: "soa-c03-content-v1",
  time_limit_minutes: 130,
  question_count: 3,
  scored_question_count: 2,
  question_types: ["multiple_choice", "multiple_response"],
  items: [
    {
      order: 1,
      question: {
        id: "q1",
        domain_id: "domain-1",
        task_id: "1.1",
        prompt: "First question?",
        instruction: "Choose ONE.",
        interaction_type: "multiple_choice",
        assessment_mode: "application",
        difficulty_prior: 0.5,
        concepts: [],
        hints: [],
        interaction: { type: "multiple_choice", choices },
      },
    },
    {
      order: 2,
      question: {
        id: "q2",
        domain_id: "domain-1",
        task_id: "1.1",
        prompt: "Second question?",
        instruction: "Choose ONE.",
        interaction_type: "multiple_choice",
        assessment_mode: "application",
        difficulty_prior: 0.5,
        concepts: [],
        hints: [],
        interaction: { type: "multiple_choice", choices },
      },
    },
    {
      order: 3,
      question: {
        id: "q3",
        domain_id: "domain-2",
        task_id: "2.1",
        prompt: "Third question?",
        instruction: "Choose TWO.",
        interaction_type: "multiple_response",
        assessment_mode: "application",
        difficulty_prior: 0.5,
        concepts: [],
        hints: [],
        interaction: { type: "multiple_response", choices, required_selections: 2 },
      },
    },
  ],
} as unknown as PracticeTestResponse;

function reviewItem(order: number, questionId: string): PracticeTestItemResult {
  return {
    order,
    question_id: questionId,
    domain_id: "domain-1",
    task_id: "1.1",
    prompt: `Question ${order}?`,
    instruction: "Choose ONE.",
    interaction_type: "multiple_choice",
    assessment_mode: "application",
    interaction: { type: "multiple_choice", choices },
    canonical_answer: { type: "multiple_choice", choice_id: "B" },
    explanation: "Because bravo is correct.",
    choice_feedback: { B: "Correct.", A: "No." },
    is_scored: true,
    answered: true,
    submitted_answer: { choice_id: "B" },
    correct: true,
  } as PracticeTestItemResult;
}

const result = {
  id: practiceTest.id,
  title: practiceTest.title,
  exam_code: "SOA-C03",
  total_questions: 3,
  scored_question_count: 2,
  correct_count: 2,
  raw_accuracy: 1,
  answered_count: 3,
  unanswered_count: 0,
  domain_breakdown: [{ domain_id: "domain-1", correct: 2, scored_count: 2 }],
  questions: [reviewItem(1, "q1"), reviewItem(2, "q2"), reviewItem(3, "q3")],
  score_note: "This is a raw practice score, not an AWS scaled score.",
} as unknown as PracticeTestResultResponse;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function stubFetch(options: { submitDelayMs?: number } = {}) {
  const { submitDelayMs = 0 } = options;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("/submit")) {
        if (submitDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, submitDelayMs));
        }
        return jsonResponse(result);
      }
      if (url.includes("/practice-tests/")) {
        return jsonResponse(practiceTest);
      }
      return jsonResponse({ error: { code: "not_found" } }, 404);
    }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={[
        "/tracks/aws-soa-c03/practice-tests/aws-soa-c03-practice-test-1",
      ]}
    >
      <Routes>
        <Route
          path="/tracks/:certificationId/practice-tests/:practiceTestId"
          element={<PracticeTestPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function startExam() {
  const user = userEvent.setup();
  await screen.findByText(/3 questions/);
  await user.click(screen.getByRole("button", { name: /Start practice test/i }));
  await screen.findByText("First question?");
  return user;
}

describe("PracticeTestPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("shows the exam facts before starting", async () => {
    renderPage();
    expect(await screen.findByText(/3 questions/)).toBeInTheDocument();
    expect(screen.getByText(/130 minutes/)).toBeInTheDocument();
    expect(screen.getByText(/reviewed after final submission/i)).toBeInTheDocument();
  });

  it("hides the question grid until the learner opens it", async () => {
    renderPage();
    const user = await startExam();

    expect(
      screen.queryByRole("navigation", { name: "Question navigator" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "All questions" }));
    expect(
      screen.getByRole("navigation", { name: "Question navigator" }),
    ).toBeInTheDocument();
  });

  it("keeps the selected answer when navigating away and back", async () => {
    renderPage();
    const user = await startExam();

    await user.click(screen.getByRole("radio", { name: /Option bravo/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Second question?");

    await user.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("First question?");
    expect(screen.getByRole("radio", { name: /Option bravo/ })).toBeChecked();
  });

  it("distinguishes answered, marked, unanswered, and current questions", async () => {
    renderPage();
    const user = await startExam();
    await user.click(screen.getByRole("button", { name: "All questions" }));

    // Unanswered next question, current first question.
    expect(
      screen.getByRole("button", { name: "Question 1, unanswered, current" }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("button", { name: "Question 2, unanswered" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Option bravo/ }));
    expect(
      screen.getByRole("button", { name: "Question 1, answered, current" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark for review" }));
    expect(
      screen.getByRole("button", { name: "Question 1, marked, current" }),
    ).toBeInTheDocument();
  });

  it("never shows correctness during the exam", async () => {
    renderPage();
    const user = await startExam();
    await user.click(screen.getByRole("radio", { name: /Option alpha/ }));

    expect(screen.queryByText(/^Correct$/)).toBeNull();
    expect(screen.queryByText(/^Incorrect$/)).toBeNull();
  });

  it("blocks over-selecting a multiple-response question", async () => {
    renderPage();
    const user = await startExam();

    // The navigator is collapsed by default; open it to jump to a question.
    await user.click(screen.getByRole("button", { name: "All questions" }));
    await user.click(screen.getByRole("button", { name: /Question 3/ }));
    await screen.findByText("Third question?");

    await user.click(screen.getByRole("checkbox", { name: /Option alpha/ }));
    await user.click(screen.getByRole("checkbox", { name: /Option bravo/ }));
    await user.click(screen.getByRole("checkbox", { name: /Option charlie/ }));

    expect(screen.getByText(/Deselect an answer first/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Option charlie/ })).not.toBeChecked();
  });

  it("marks a question for review", async () => {
    renderPage();
    const user = await startExam();

    await user.click(screen.getByRole("button", { name: "Mark for review" }));
    expect(
      screen.getByRole("button", { name: "Marked for review" }),
    ).toBeInTheDocument();
  });

  it("confirms before submitting and then shows the review", async () => {
    renderPage();
    const user = await startExam();
    await user.click(screen.getByRole("radio", { name: /Option bravo/ }));

    await user.click(screen.getByRole("button", { name: "Submit test" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/unanswered question/);

    await user.click(
      within(dialog).getByRole("button", { name: "Submit test" }),
    );

    expect(await screen.findByText(/Practice score:/)).toBeInTheDocument();
    expect(screen.getByText(/Raw accuracy:/)).toBeInTheDocument();
    expect(screen.getByText(/Because bravo is correct/)).toBeInTheDocument();
  });

  it("restores an in-flight attempt from storage after a refresh", async () => {
    const attempt = startAttempt(practiceTest, "aws-soa-c03", Date.now());
    saveAttempt({
      ...attempt,
      currentIndex: 1,
      answers: { q1: { choice_id: "A" } },
    });

    renderPage();
    expect(await screen.findByText("Second question?")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("First question?")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Option alpha/ })).toBeChecked();
  });

  it("auto-submits when the deadline has passed", async () => {
    // Delay the submit so the locked exam state is observable before results.
    stubFetch({ submitDelayMs: 300 });
    const attempt = startAttempt(practiceTest, "aws-soa-c03", Date.now());
    saveAttempt({
      ...attempt,
      startedAt: new Date(Date.now() - 200 * 60_000).toISOString(),
      deadlineAt: new Date(Date.now() - 60_000).toISOString(),
    });

    renderPage();
    expect(await screen.findByText(/Time is up/)).toBeInTheDocument();
    // Answers are locked once time is up.
    expect(screen.getByRole("radio", { name: /Option alpha/ })).toBeDisabled();
    await waitFor(
      () => expect(screen.getByText(/Practice score:/)).toBeInTheDocument(),
      { timeout: 2000 },
    );
  });

  it("renders tactile interactions in an exam and reviews their canonical answer", async () => {
    const classification = {
      type: "classification",
      items: [
        { id: "i1", label: "Storage account" },
        { id: "i2", label: "Virtual network" },
      ],
      categories: [
        { id: "c1", label: "Storage" },
        { id: "c2", label: "Networking" },
      ],
    };
    const azureTest = {
      ...practiceTest,
      id: "microsoft-az-104-practice-test-1",
      title: "AZ-104 Practice Test 1",
      exam_code: "AZ-104",
      certification_version: "az-104",
      question_count: 1,
      scored_question_count: 1,
      question_types: ["classification"],
      items: [
        {
          order: 1,
          question: {
            id: "q-classify",
            domain_id: "domain-1",
            task_id: "1.1",
            prompt: "Place the resources.",
            instruction: "Choose ONE.",
            interaction_type: "classification",
            assessment_mode: "recognition",
            difficulty_prior: 0.4,
            concepts: [],
            hints: [],
            interaction: classification,
          },
        },
      ],
    } as unknown as PracticeTestResponse;

    const azureResult = {
      ...result,
      id: azureTest.id,
      total_questions: 1,
      scored_question_count: 1,
      correct_count: 1,
      raw_accuracy: 1,
      answered_count: 1,
      unanswered_count: 0,
      domain_breakdown: [{ domain_id: "domain-1", correct: 1, scored_count: 1 }],
      questions: [
        {
          order: 1,
          question_id: "q-classify",
          domain_id: "domain-1",
          task_id: "1.1",
          prompt: "Place the resources.",
          instruction: "Choose ONE.",
          interaction_type: "classification",
          assessment_mode: "recognition",
          interaction: classification,
          canonical_answer: {
            type: "classification",
            placements: { i1: "c1", i2: "c2" },
          },
          explanation: "Storage accounts belong to the Storage category.",
          choice_feedback: {},
          is_scored: true,
          answered: true,
          submitted_answer: { placements: { i1: "c1", i2: "c2" } },
          correct: true,
        },
      ],
      score_note: "This is a raw practice score, not an official scaled score.",
    } as unknown as PracticeTestResultResponse;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes("/submit")) {
          return jsonResponse(azureResult);
        }
        if (url.includes("/practice-tests/")) {
          return jsonResponse(azureTest);
        }
        return jsonResponse({ error: { code: "not_found" } }, 404);
      }),
    );

    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /Start practice test/i }),
    );
    await screen.findByText("Place the resources.");

    // The tactile interaction renders instead of the "unsupported" fallback.
    expect(
      screen.queryByText(/not supported in exam simulation/i),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Storage account" }));
    await user.click(
      within(screen.getByRole("group", { name: "Storage" })).getByRole(
        "button",
        { name: "Place here" },
      ),
    );
    await user.click(screen.getByRole("button", { name: "Virtual network" }));
    await user.click(
      within(screen.getByRole("group", { name: "Networking" })).getByRole(
        "button",
        { name: "Place here" },
      ),
    );

    await user.click(screen.getByRole("button", { name: "All questions" }));
    expect(
      screen.getByRole("button", { name: "Question 1, answered, current" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Submit test" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Submit test" }),
    );

    // The review falls back to readable canonical-answer lines.
    expect(await screen.findByText("Correct answer")).toBeInTheDocument();
    expect(screen.getByText("Storage account")).toBeInTheDocument();
    expect(screen.getByText("Storage")).toBeInTheDocument();
  });
});
