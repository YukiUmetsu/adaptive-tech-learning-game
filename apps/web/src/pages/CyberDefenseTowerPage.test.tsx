import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TOWER_UPGRADES,
  TOWER_UPGRADES_BY_ID,
} from "../game/data/towerUpgrades";

// The page reads the shared profile store and posts purchases. Mock only the
// network-bound actions and the refresh, keeping the real store so tests can
// seed a profile and observe updates exactly as the app would.
vi.mock("../game/state/cyberProfile", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../game/state/cyberProfile")>();
  return {
    ...actual,
    refreshCyberProfile: vi.fn(async () => actual.getCyberProfile()),
    purchaseTowerUpgrade: vi.fn(),
  };
});

import {
  getCyberProfile,
  purchaseTowerUpgrade,
  refreshCyberProfile,
  resetCyberProfile,
  setCyberProfile,
  type CyberProfile,
} from "../game/state/cyberProfile";
import CyberDefenseTowerPage from "./CyberDefenseTowerPage";

function baseProfile(): CyberProfile {
  return {
    adversaries: [],
    bits_balance: 0,
    campaign: [],
    career: {
      level: 1,
      next_level_xp: 100,
      rank: "Analyst",
      xp: 0,
      xp_for_next_level: 100,
      xp_into_level: 0,
    },
    heroes: [],
    highest_threat_level_cleared: 0,
    legacy_progress_imported: true,
    recommended_threat_level: 1,
    story: { active_chapter: "chapter-1", completed_nodes: [] },
    total_operations_completed: 0,
    tower_level: 1,
    tower_upgrades: [],
    unlocked_threat_level: 1,
    operations_unlocked: false,
    confrontation_available: false,
    available_adversaries: [],
  };
}

/** Builds a profile with the given Bits balance and room levels. */
function towerProfile(options: {
  bits?: number;
  rooms?: Record<string, number>;
}): CyberProfile {
  const rooms = options.rooms ?? {};
  const upgrades = TOWER_UPGRADES.map((definition) => {
    const level = rooms[definition.id] ?? 0;
    return {
      level,
      max_level: definition.maxLevel,
      next_cost: definition.costs[level] ?? null,
      upgrade_id: definition.id,
    };
  });
  return {
    ...baseProfile(),
    bits_balance: options.bits ?? 0,
    tower_level: 1 + upgrades.reduce((sum, room) => sum + room.level, 0),
    tower_upgrades: upgrades,
  };
}

/** Applies a successful purchase to the shared store, like the real refresh. */
function settlePurchase(upgradeId: string): void {
  const current = getCyberProfile();
  if (!current) {
    throw new Error("no profile seeded");
  }
  const definition = TOWER_UPGRADES_BY_ID[upgradeId];
  const room = current.tower_upgrades.find(
    (entry) => entry.upgrade_id === upgradeId,
  );
  const level = (room?.level ?? 0) + 1;
  const spent = definition.costs[level - 1] ?? 0;
  setCyberProfile({
    ...current,
    bits_balance: current.bits_balance - spent,
    tower_level: current.tower_level + 1,
    tower_upgrades: current.tower_upgrades.map((entry) =>
      entry.upgrade_id === upgradeId
        ? {
            level,
            max_level: definition.maxLevel,
            next_cost: definition.costs[level] ?? null,
            upgrade_id: upgradeId,
          }
        : entry,
    ),
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CyberDefenseTowerPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetCyberProfile();
  vi.clearAllMocks();
  vi.mocked(refreshCyberProfile).mockImplementation(async () =>
    getCyberProfile(),
  );
});

describe("CyberDefenseTowerPage", () => {
  it("marks an affordable upgrade as ready and enables its button", async () => {
    setCyberProfile(towerProfile({ bits: 40 }));

    renderPage();

    const button = await screen.findByRole("button", {
      name: /Upgrade Security Operations Center to level 1 for 40 Bits/,
    });
    expect(button).toBeEnabled();
    expect(screen.getByText("Ready to build")).toBeInTheDocument();
  });

  it("disables an unaffordable upgrade and explains why", async () => {
    setCyberProfile(towerProfile({ bits: 10 }));

    renderPage();

    const button = await screen.findByRole("button", {
      name: /Upgrade Security Operations Center to level 1 for 40 Bits/,
    });
    expect(button).toBeDisabled();
    expect(screen.getByText("30 more Bits needed")).toBeInTheDocument();
  });

  it("disables the button once a room reaches its maximum level", async () => {
    setCyberProfile(towerProfile({ bits: 1_000, rooms: { soc: 4 } }));

    renderPage();

    const button = await screen.findByRole("button", {
      name: /Security Operations Center is fully upgraded/,
    });
    expect(button).toBeDisabled();
    expect(screen.getByText("All upgrades complete.")).toBeInTheDocument();
  });

  it("disables a room whose prerequisite is unmet", async () => {
    setCyberProfile(towerProfile({ bits: 1_000, rooms: { soc: 0 } }));

    renderPage();

    const button = await screen.findByRole("button", {
      name: /Upgrade Threat Intelligence to level 1 for 60 Bits/,
    });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/Requires Security Operations Center Lv 1/),
    ).toBeInTheDocument();
  });

  it("spends Bits and raises the tower level after a purchase", async () => {
    const user = userEvent.setup();
    vi.mocked(purchaseTowerUpgrade).mockImplementation(async (upgradeId) => {
      settlePurchase(upgradeId);
      const updated = getCyberProfile()!;
      return {
        ok: true,
        data: {
          bits_balance: updated.bits_balance,
          level: updated.tower_upgrades.find(
            (entry) => entry.upgrade_id === upgradeId,
          )!.level,
          newly_settled: true,
          spent: TOWER_UPGRADES_BY_ID[upgradeId].costs[0],
          tower_level: updated.tower_level,
          upgrade_id: upgradeId,
        },
      };
    });
    setCyberProfile(towerProfile({ bits: 40 }));

    renderPage();

    expect(screen.getByText("1 of 15")).toBeInTheDocument();
    expect(screen.getByText("40 Bits")).toBeInTheDocument();

    await user.click(
      await screen.findByRole("button", {
        name: /Upgrade Security Operations Center to level 1 for 40 Bits/,
      }),
    );

    await waitFor(() =>
      expect(screen.getByText("0 Bits")).toBeInTheDocument(),
    );
    expect(purchaseTowerUpgrade).toHaveBeenCalledWith("soc", expect.any(String));
    expect(screen.getByText("Level 1")).toBeInTheDocument();
    expect(screen.getByText("2 of 15")).toBeInTheDocument();
  });

  it("shows the server message when a purchase fails", async () => {
    const user = userEvent.setup();
    vi.mocked(purchaseTowerUpgrade).mockResolvedValue({
      ok: false,
      code: "insufficient_bits",
      message: "Not enough Bits.",
      activeRunId: null,
    });
    setCyberProfile(towerProfile({ bits: 40 }));

    renderPage();

    await user.click(
      await screen.findByRole("button", {
        name: /Upgrade Security Operations Center/,
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Not enough Bits.",
    );
  });

  it("recovers the button when the purchase request rejects", async () => {
    const user = userEvent.setup();
    vi.mocked(purchaseTowerUpgrade).mockRejectedValue(new Error("offline"));
    setCyberProfile(towerProfile({ bits: 40 }));

    renderPage();

    const button = await screen.findByRole("button", {
      name: /Upgrade Security Operations Center/,
    });
    await user.click(button);

    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveTextContent("Upgrade");
  });

  it("celebrates a successful upgrade", async () => {
    const user = userEvent.setup();
    vi.mocked(purchaseTowerUpgrade).mockResolvedValue({
      ok: true,
      data: {
        upgrade_id: "soc",
        level: 1,
        tower_level: 2,
        bits_balance: 0,
        spent: 40,
        newly_settled: true,
      },
    });
    setCyberProfile(towerProfile({ bits: 40 }));

    renderPage();

    await user.click(
      await screen.findByRole("button", {
        name: /Upgrade Security Operations Center/,
      }),
    );

    expect(await screen.findByText("+1")).toBeInTheDocument();
  });
});
