import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChallengeList from "./ChallengeList";
import { startChallenge } from "../state/mission";

vi.mock("../state/mission", () => ({
  startChallenge: vi.fn(),
}));

vi.mock("../state/learningProgress", () => ({
  loadTrackDiscovery: () => [],
}));

const challenge = {
  id: "ch-1",
  title: "Zip Journey",
  description: "A guided sequence.",
  estimated_minutes: 8,
  stage_count: 4,
  prerequisite_node_ids: [],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("ChallengeList", () => {
  it("renders authored challenges and starts one", async () => {
    vi.mocked(startChallenge).mockResolvedValue({
      id: "mission-1",
    } as never);

    render(
      <MemoryRouter>
        <ChallengeList
          trackId="ai-python-fluency"
          trackVersion="python-fluency-v1"
          challenges={[challenge]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Zip Journey")).toBeInTheDocument();
    expect(screen.getByText(/4 stages/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(startChallenge).toHaveBeenCalledWith({
        certificationId: "ai-python-fluency",
        challengeId: "ch-1",
        discovery: [],
      }),
    );
  });

  it("renders nothing without authored challenges", () => {
    const { container } = render(
      <MemoryRouter>
        <ChallengeList
          trackId="t"
          trackVersion="v"
          challenges={[]}
        />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
