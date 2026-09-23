import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CertificationDto } from "../api/types";
import { clearCatalogCache } from "../hooks/useCatalog";
import LearningTracksNav from "./LearningTracksNav";

function certification(
  id: string,
  name: string,
  examCode = "CODE",
): CertificationDto {
  return {
    id,
    vendor: "AWS",
    name,
    exam_code: examCode,
    official_source_url: "https://example.com",
    last_reviewed: "2026-09-18",
    versions: [],
  };
}

const catalog = {
  certifications: [
    certification(
      "aws-soa-c03",
      "AWS Certified CloudOps Engineer - Associate",
      "SOA-C03",
    ),
    certification(
      "aws-saa-c03",
      "AWS Certified Solutions Architect - Associate",
      "SAA-C03",
    ),
    certification(
      "aws-aip-c01",
      "AWS Certified Generative AI Developer - Professional",
      "AIP-C01",
    ),
    certification(
      "ai-pytorch-core",
      "PyTorch Core: Practical ML & Neural Networks",
      "PYTORCH-CORE",
    ),
    certification("python-data-stack", "Python Data Stack", "PY-DATA-STACK"),
  ],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Shows the current pathname so navigation can be asserted. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

function renderNav(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LearningTracksNav />
      <LocationProbe />
      <Routes>
        <Route path="/tracks" element={<p>Tracks page</p>} />
        <Route path="/tracks/:id" element={<p>Track page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Simulates a mouse entering an element (pointer events with mouse type). */
function hover(element: Element) {
  fireEvent.pointerEnter(element, { pointerType: "mouse" });
}

/** Simulates a mouse leaving an element. */
function unhover(element: Element) {
  fireEvent.pointerLeave(element, { pointerType: "mouse" });
}

beforeEach(() => {
  clearCatalogCache();
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(catalog)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LearningTracksNav", () => {
  it("renders the Learning Tracks link to the existing tracks route", async () => {
    renderNav();

    const trigger = await screen.findByRole("link", {
      name: /Learning Tracks/,
    });
    expect(trigger).toHaveAttribute("href", "/tracks");
    // Closed until hovered/focused.
    expect(screen.queryByRole("link", { name: /PyTorch Core/ })).toBeNull();
  });

  it("opens the dropdown on hover and lists every catalog track", async () => {
    renderNav();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });

    hover(trigger.parentElement as Element);

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /CloudOps Engineer - Associate/ }),
      ).toBeInTheDocument(),
    );

    for (const name of [
      /Solutions Architect - Associate/,
      /Generative AI Developer - Professional/,
      /PyTorch Core/,
      /Python Data Stack/,
    ]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("groups tracks and links each to its existing track route", async () => {
    renderNav();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });
    hover(trigger.parentElement as Element);

    const soa = await screen.findByRole("link", {
      name: /CloudOps Engineer - Associate/,
    });
    const pytorch = screen.getByRole("link", { name: /PyTorch Core/ });
    const dataStack = screen.getByRole("link", { name: /Python Data Stack/ });

    expect(soa).toHaveAttribute("href", "/tracks/aws-soa-c03");
    expect(pytorch).toHaveAttribute("href", "/tracks/ai-pytorch-core");
    expect(dataStack).toHaveAttribute("href", "/tracks/python-data-stack");

    // Group headings come from the shared catalog metadata.
    expect(screen.getByText("AWS")).toBeInTheDocument();
    expect(screen.getByText("AI & Machine Learning")).toBeInTheDocument();
  });

  it("shows certifications before non-certification tracks", async () => {
    renderNav();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });
    hover(trigger.parentElement as Element);

    const menu = await screen.findByLabelText("Learning tracks");
    const headings = within(menu)
      .getAllByText(/^(AWS|AI & Machine Learning)$/)
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["AWS", "AI & Machine Learning"]);
  });

  it("shows exam-code tags only for certification tracks", async () => {
    renderNav();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });
    hover(trigger.parentElement as Element);

    await screen.findByRole("link", { name: /PyTorch Core/ });

    // Certification tracks show their exam code.
    expect(screen.getByText("SOA-C03")).toBeInTheDocument();
    expect(screen.getByText("SAA-C03")).toBeInTheDocument();
    expect(screen.getByText("AIP-C01")).toBeInTheDocument();

    // Non-certification tracks do not.
    expect(screen.queryByText("PYTORCH-CORE")).toBeNull();
    expect(screen.queryByText("PYTHON-FLUENCY")).toBeNull();
    expect(screen.queryByText("PY-DATA-STACK")).toBeNull();
  });

  it("keeps the CompTIA vendor in the dropdown label", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          certifications: [
            certification(
              "comptia-security-plus",
              "CompTIA Security+",
              "SY0-701",
            ),
          ],
        }),
      ),
    );

    renderNav();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });
    hover(trigger.parentElement as Element);

    const menu = await screen.findByLabelText("Learning tracks");
    const item = within(menu).getByRole("link", {
      name: /CompTIA Security\+/,
    });
    expect(item).toHaveAttribute("href", "/tracks/comptia-security-plus");
    // The exam code tag rides on the same full-width row.
    expect(within(item).getByText("SY0-701")).toBeInTheDocument();
  });

  it("does not repeat the category vendor in AWS item names", async () => {
    renderNav();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });
    hover(trigger.parentElement as Element);

    const menu = await screen.findByLabelText("Learning tracks");
    // The "AWS" heading supplies the vendor, so item names omit it.
    expect(within(menu).queryByText(/AWS Certified/)).toBeNull();
    expect(
      within(menu).getByRole("link", { name: /CloudOps Engineer - Associate/ }),
    ).toBeInTheDocument();
  });

  it("stays open while the pointer moves from the trigger into the dropdown", async () => {
    renderNav();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });
    const wrapper = trigger.parentElement as Element;

    hover(wrapper);
    const item = await screen.findByRole("link", { name: /PyTorch Core/ });

    // Leaving the wrapper and entering the panel (same wrapper) must not close
    // the menu immediately.
    unhover(wrapper);
    hover(wrapper);
    expect(item).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Python Data Stack/ }),
    ).toBeInTheDocument();
  });

  it("closes after the pointer leaves the trigger and dropdown", async () => {
    renderNav();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });
    const wrapper = trigger.parentElement as Element;

    hover(wrapper);
    expect(
      await screen.findByRole("link", { name: /PyTorch Core/ }),
    ).toBeInTheDocument();

    unhover(wrapper);
    // The short grace period elapses, then the menu closes.
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /PyTorch Core/ })).toBeNull(),
    );
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    renderNav();
    const user = userEvent.setup();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });

    await user.tab();
    expect(trigger).toHaveFocus();
    await screen.findByRole("link", { name: /PyTorch Core/ });

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /PyTorch Core/ })).toBeNull(),
    );
    expect(trigger).toHaveFocus();
  });

  it("closes when focus moves completely outside the menu", async () => {
    renderNav();
    const user = userEvent.setup();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });

    await user.tab();
    await screen.findByRole("link", { name: /PyTorch Core/ });

    // Tabbing out of the wrapper (no menu items are focused) blurs the trigger.
    fireEvent.blur(trigger.parentElement as Element, { relatedTarget: document.body });

    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /PyTorch Core/ })).toBeNull(),
    );
  });

  it("navigates when a track is clicked and closes the menu", async () => {
    renderNav();
    const user = userEvent.setup();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });
    hover(trigger.parentElement as Element);

    const item = await screen.findByRole("link", { name: /Python Data Stack/ });
    await user.click(item);

    expect(screen.getByTestId("path")).toHaveTextContent(
      "/tracks/python-data-stack",
    );
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /PyTorch Core/ })).toBeNull(),
    );
  });

  it("keeps the parent Learning Tracks link working", async () => {
    renderNav();
    const user = userEvent.setup();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });

    await user.click(trigger);

    expect(screen.getByTestId("path")).toHaveTextContent("/tracks");
    expect(screen.getByText("Tracks page")).toBeInTheDocument();
  });

  it("supports opening with ArrowDown and moving into the menu", async () => {
    renderNav();
    const user = userEvent.setup();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });

    await user.tab();
    expect(trigger).toHaveFocus();

    await user.keyboard("{ArrowDown}");

    // Certification groups are listed first, so the first menu item is the
    // first AWS certification.
    const first = await screen.findByRole("link", {
      name: /CloudOps Engineer - Associate/,
    });
    await waitFor(() => expect(first).toHaveFocus());
  });

  it("marks the trigger expanded when open", async () => {
    renderNav();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    hover(trigger.parentElement as Element);
    await screen.findByRole("link", { name: /PyTorch Core/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("does not open on touch pointer events", async () => {
    renderNav();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });

    fireEvent.pointerEnter(trigger.parentElement as Element, {
      pointerType: "touch",
    });

    expect(screen.queryByRole("link", { name: /PyTorch Core/ })).toBeNull();
  });

  it("still lets touch users reach tracks by tapping the parent link", async () => {
    renderNav();
    const user = userEvent.setup();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });

    // A touch tap must not open the menu...
    fireEvent.pointerEnter(trigger.parentElement as Element, {
      pointerType: "touch",
    });
    expect(screen.queryByRole("link", { name: /Python Data Stack/ })).toBeNull();

    // ...and following the link still navigates to the tracks page.
    await user.click(trigger);
    expect(screen.getByTestId("path")).toHaveTextContent("/tracks");
  });

  it("renders safely and keeps the parent link while the catalog loads", async () => {
    // Never resolves: the navbar must not crash or block the parent link.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    renderNav();

    const trigger = screen.getByRole("link", { name: /Learning Tracks/ });
    expect(trigger).toHaveAttribute("href", "/tracks");
    expect(trigger).not.toHaveAttribute("aria-haspopup");
    expect(screen.queryByRole("link", { name: /PyTorch Core/ })).toBeNull();
  });

  it("keeps the parent link working when the catalog fails to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "boom" }, 500)),
    );

    renderNav();
    const user = userEvent.setup();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });

    hover(trigger.parentElement as Element);
    expect(screen.queryByRole("link", { name: /PyTorch Core/ })).toBeNull();

    await user.click(trigger);
    expect(screen.getByTestId("path")).toHaveTextContent("/tracks");
  });

  it("renders a menu region with an accessible label", async () => {
    renderNav();
    const trigger = await screen.findByRole("link", { name: /Learning Tracks/ });
    hover(trigger.parentElement as Element);

    const menu = await screen.findByLabelText("Learning tracks");
    expect(within(menu).getByRole("link", { name: /PyTorch Core/ })).toBeInTheDocument();
  });
});
