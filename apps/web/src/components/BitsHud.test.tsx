import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import BitsHud from "./BitsHud";
import { previewBits, reconcileBits } from "../state/wallet";

beforeEach(() => {
  window.localStorage.clear();
  reconcileBits(0);
});

describe("BitsHud", () => {
  it("shows the shared wallet balance with an accessible label", async () => {
    render(<BitsHud />);

    expect(screen.getByLabelText("0 Bits")).toBeInTheDocument();

    act(() => {
      reconcileBits(1240);
    });

    await waitFor(() =>
      expect(screen.getByTestId("bits-amount")).toHaveTextContent("1,240"),
    );
    expect(screen.getByLabelText("1,240 Bits")).toBeInTheDocument();
  });

  it("pulses briefly when the balance increases", async () => {
    render(<BitsHud />);

    act(() => {
      reconcileBits(120);
    });

    await waitFor(() =>
      expect(screen.getByTestId("bits-hud").className).toContain(
        "bits-hud-pulse",
      ),
    );
  });

  it("updates the number for an unreconciled preview without celebrating", () => {
    render(<BitsHud />);

    act(() => {
      previewBits(20);
    });

    expect(screen.getByTestId("bits-amount")).toHaveTextContent("20");
    expect(screen.getByTestId("bits-hud").className).not.toContain(
      "bits-hud-pulse",
    );
  });

  it("does not pulse when the balance is unchanged", () => {
    reconcileBits(50);
    render(<BitsHud />);

    act(() => {
      reconcileBits(50);
    });

    expect(screen.getByTestId("bits-hud").className).not.toContain(
      "bits-hud-pulse",
    );
  });
});
