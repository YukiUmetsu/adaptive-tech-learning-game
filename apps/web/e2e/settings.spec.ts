import { expect, test } from "@playwright/test";

import { signInAsDevUser } from "./helpers";

/**
 * Personal Settings page.
 *
 * Settings persist locally on the device (no save button), so these tests verify
 * the controls update, survive a reload, and reset behind a confirmation.
 */
test("settings: accessibility preferences persist and reset", async ({
  page,
}) => {
  await signInAsDevUser(page);
  await page.goto("/settings");

  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Settings sections" }),
  ).toBeVisible();

  const reducedMotion = page.getByRole("checkbox", { name: /Reduced motion/ });
  await expect(reducedMotion).not.toBeChecked();

  await reducedMotion.check();
  // The radio input is visually hidden, so select it through its visible label.
  await page.getByText("Minimal", { exact: true }).click();

  // Preferences persist across a reload on this device.
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: /Reduced motion/ }),
  ).toBeChecked();
  await expect(page.getByRole("radio", { name: "Minimal" })).toBeChecked();

  // Reset requires confirmation, then restores the defaults.
  await page.getByRole("button", { name: "Reset local preferences" }).click();
  const confirm = page.getByRole("alert", { name: "Confirm reset" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Reset preferences" }).click();

  await expect(
    page.getByRole("checkbox", { name: /Reduced motion/ }),
  ).not.toBeChecked();
  await expect(page.getByRole("radio", { name: "Full" })).toBeChecked();
});

test("settings: master volume mutes the dependent audio controls", async ({
  page,
}) => {
  await signInAsDevUser(page);
  await page.goto("/settings");

  const master = page.getByRole("slider", { name: /Master volume/ });
  await expect(master).toHaveValue("50");
  await expect(
    page.getByRole("slider", { name: /Answer feedback/ }),
  ).toBeEnabled();

  await master.fill("0");

  await expect(
    page.getByRole("slider", { name: /Answer feedback/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("slider", { name: /Battle music/ }),
  ).toBeDisabled();
});
