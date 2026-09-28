import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * Cyber Defense Stage 2 end-to-end coverage.
 *
 * The tower-defense battle is a real-time browser simulation (3–6 minutes), so
 * finishing a mission by "playing" it is not practical in a smoke test. These
 * tests instead seed the Chapter 1 campaign through the same public API the game
 * calls, then drive the Cyber Defense UI for the progression behaviours that
 * matter: server-authoritative unlocking, operator/difficulty choice, Tower
 * intel gating, server-side settlement, and persistence across a refresh.
 *
 * Settlement now enforces a server-elapsed floor (a run cannot settle the
 * instant it was created), so the API-settled test ages the run before
 * completing it, exactly as a real multi-minute battle would.
 *
 * Every test uses a unique local developer identity, so runs never share state.
 */

const API_PORT = process.env.E2E_API_PORT ?? "8080";
const API_BASE = `http://127.0.0.1:${API_PORT}`;

/** The five Stage 1 campaign missions, in order. */
const CAMPAIGN_MISSIONS = [
  "ddos-basics",
  "sql-injection",
  "credential-stuffing",
  "mixed-defense",
  "botnet-boss",
];

/**
 * Signs the browser in as a fresh local developer subject.
 *
 * The subject is written to `sessionStorage`, which `LocalAuthProvider` reads at
 * mount, then the next navigation boots the app already authenticated. This
 * avoids the shared `local-user` identity the login button would use.
 */
async function signInAsFreshUser(page: Page, subject: string): Promise<void> {
  await page.goto("/");
  await page.evaluate((value) => {
    window.sessionStorage.setItem("adaptive-learn.dev-subject", value);
  }, subject);
}

function authHeaders(subject: string): Record<string, string> {
  return { authorization: `Bearer dev:${subject}` };
}

/**
 * Completes every Chapter 1 mission through the API.
 *
 * This is the same endpoint a settled browser battle calls; it grants the
 * campaign Bits used later for the Tower purchase.
 */
async function seedCampaignComplete(
  request: APIRequestContext,
  subject: string,
): Promise<void> {
  const headers = authHeaders(subject);
  // The first authenticated request creates the user row before any FK writes.
  const profile = await request.get(`${API_BASE}/v1/cyber-defense/profile`, {
    headers,
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();

  for (const missionId of CAMPAIGN_MISSIONS) {
    const response = await request.post(
      `${API_BASE}/v1/cyber-defense/campaign/${missionId}/complete`,
      {
        headers,
        data: {
          result_id: randomUUID(),
          stars: 3,
          health: 90,
          duration_ms: 90_000,
          hero_id: "security_engineer",
        },
      },
    );
    expect(response.ok(), `${missionId}: ${await response.text()}`).toBeTruthy();
  }
}

/** The operation run id from the current `/game/operations/:runId` URL. */
function runIdFromUrl(page: Page): string {
  const parts = new URL(page.url()).pathname.split("/");
  return parts[parts.length - 1];
}

test("fresh campaign unlocks Operations; operator, difficulty, and Tower intel persist", async ({
  page,
  request,
}) => {
  const subject = `cyber-e2e-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await signInAsFreshUser(page, subject);

  // A fresh account starts on the campaign, not Operations.
  await page.goto("/game");
  await expect(
    page.getByRole("link", { name: /continue campaign/i }),
  ).toBeVisible();

  // Server-authoritative unlocking: complete Chapter 1 through the API, with no
  // local Stage 1 progress, and the dashboard reflects it on reload.
  await seedCampaignComplete(request, subject);
  await page.reload();

  await expect(
    page.getByRole("radio", { name: /Security Engineer/ }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: /SRE/ })).toBeVisible();

  // Choose the SRE and a non-recommended Threat Level before deploying.
  // The dashboard now presents server-issued offers; the first is selected by
  // default and "Deploy" starts it.
  await page.getByRole("radio", { name: /SRE/ }).click();
  await page.getByRole("radio", { name: "2" }).click();
  await page.getByRole("button", { name: /^deploy$/i }).click();

  // Briefing: without SOC / Threat Intelligence, wave detail and the adversary
  // specialty stay hidden, and the chosen operator is shown.
  await expect(page).toHaveURL(/\/game\/operations\//);
  await expect(page.getByText(/Threat categories unknown/i)).toBeVisible();
  await expect(page.getByText(/Specialty unknown/i)).toBeVisible();
  await expect(page.getByText("SRE", { exact: true })).toBeVisible();

  // Leave the run and spend the campaign Bits on the SOC.
  await page.getByRole("button", { name: /abandon operation/i }).click();
  await expect(page).toHaveURL(/\/game$/);

  await page.goto("/game/tower");
  const upgradeToLevel2 = page.getByRole("button", {
    name: /^Upgrade Security Operations Center to level 2/,
  });
  await page
    .getByRole("button", {
      name: /^Upgrade Security Operations Center to level 1/,
    })
    .click();
  await expect(upgradeToLevel2).toBeVisible();

  // SOC Lv2 requires a second purchase; the tier only reveals at level 2+.
  await upgradeToLevel2.click();
  await expect(
    page.getByRole("button", {
      name: /^Upgrade Security Operations Center to level 3/,
    }),
  ).toBeVisible();

  // The upgrade is server-persisted across a reload.
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: /^Upgrade Security Operations Center to level 3/,
    }),
  ).toBeVisible();

  // A new Operation briefing now reveals the first upcoming wave.
  await page.goto("/game");
  await page.getByRole("button", { name: /^deploy$/i }).click();
  await expect(page).toHaveURL(/\/game\/operations\//);
  await expect(page.getByText(/Wave 1/)).toBeVisible();
  // Threat Intelligence is still Lv1, so the specialty stays hidden.
  await expect(page.getByText(/Specialty unknown/i)).toBeVisible();
});

test("the selected hero is the only deployable hero and DEPLOY locks the run", async ({
  page,
  request,
}) => {
  const subject = `cyber-e2e-deploy-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await signInAsFreshUser(page, subject);
  await seedCampaignComplete(request, subject);

  // Choose the SRE and start an Operation from the dashboard.
  await page.goto("/game");
  await page.getByRole("radio", { name: /SRE/ }).click();
  await page.getByRole("button", { name: /^deploy$/i }).click();
  await expect(page).toHaveURL(/\/game\/operations\//);

  // Briefing still shows the assigned operator before the battle starts.
  await expect(page.getByText("SRE", { exact: true })).toBeVisible();

  // DEPLOY is what freezes the configuration and opens the battle.
  await page.locator(".cyber-op-deploy").click();

  // Only the selected hero is offered in the battle roster.
  const heroes = page.locator(".cyber-heroes");
  await expect(heroes).toContainText("SRE");
  await expect(heroes).not.toContainText("Security Engineer");

  // Leave, then return: the server says deployed, so the briefing (and its
  // loadout editing) is skipped and the battle opens directly.
  const runId = runIdFromUrl(page);
  await page.goto("/game");
  await page.goto(`/game/operations/${runId}`);

  await expect(page.locator(".cyber-op-deploy")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /start wave/i })).toBeVisible();
});

test("a settled Operation persists its reward on the dashboard", async ({
  page,
  request,
}) => {
  const subject = `cyber-e2e-op-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await signInAsFreshUser(page, subject);
  await seedCampaignComplete(request, subject);

  await page.goto("/game");
  await page.getByRole("button", { name: /^deploy$/i }).click();
  await expect(page).toHaveURL(/\/game\/operations\//);
  const runId = runIdFromUrl(page);

  // A run that was never deployed has no battle to settle.
  const undeployed = await request.post(
    `${API_BASE}/v1/cyber-defense/operations/${runId}/complete`,
    {
      headers: authHeaders(subject),
      data: { completed: true, stars: 2, health: 60, duration_ms: 120_000 },
    },
  );
  expect(undeployed.status()).toBe(409);
  expect((await undeployed.json()).error.code).toBe(
    "cyber_operation_not_deployed",
  );

  // DEPLOY freezes the run and starts the combat clock.
  const deployed = await request.post(
    `${API_BASE}/v1/cyber-defense/operations/${runId}/deploy`,
    { headers: authHeaders(subject) },
  );
  expect(deployed.ok(), await deployed.text()).toBeTruthy();

  // The integrity guard rejects a run that settles before it could plausibly
  // have been played. Age it past the minimum plausible window.
  await page.waitForTimeout(21_000);

  // Settle the run through the API (the battle itself runs in real time).
  const settled = await request.post(
    `${API_BASE}/v1/cyber-defense/operations/${runId}/complete`,
    {
      headers: authHeaders(subject),
      data: {
        completed: true,
        stars: 2,
        health: 60,
        duration_ms: 120_000,
      },
    },
  );
  expect(settled.ok(), await settled.text()).toBeTruthy();

  // The dashboard reflects the server-settled progress after a refresh.
  await page.goto("/game");
  await expect(
    page.locator('li[title="Completed Operations"] .cyber-hub-resource-value'),
  ).toHaveText("1");
});
