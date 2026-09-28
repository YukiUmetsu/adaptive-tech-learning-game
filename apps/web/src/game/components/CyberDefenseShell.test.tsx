import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  resetCyberProfile,
  setCyberProfile,
  type CyberProfile,
} from "../state/cyberProfile";
import CyberDefenseRoot from "./CyberDefenseShell";
import { cyberThemeAttribute } from "./cyberTheme";

/**
 * Theme scope.
 *
 * The equipped Tower theme is expressed once as a `data-cyber-theme` attribute
 * on the Cyber Defense root. No equipped theme must leave the default look
 * completely unchanged.
 */

function withTheme(theme: string | null) {
  setCyberProfile({ equipped_theme: theme } as CyberProfile);
}

afterEach(() => {
  resetCyberProfile();
});

describe("CyberDefenseRoot", () => {
  it("exposes the equipped theme as data-cyber-theme", () => {
    withTheme("red-alert");
    const { container } = render(
      <CyberDefenseRoot>
        <p>board</p>
      </CyberDefenseRoot>,
    );
    expect(
      container.querySelector(".cyber-theme-root")?.getAttribute("data-cyber-theme"),
    ).toBe("red-alert");
  });

  it("leaves the default look when no theme is equipped", () => {
    withTheme(null);
    const { container } = render(
      <CyberDefenseRoot>
        <p>board</p>
      </CyberDefenseRoot>,
    );
    expect(
      container.querySelector(".cyber-theme-root")?.hasAttribute("data-cyber-theme"),
    ).toBe(false);
  });

  it("maps equipped themes to the attribute helper", () => {
    expect(cyberThemeAttribute("violet-grid")).toBe("violet-grid");
    expect(cyberThemeAttribute(null)).toBeUndefined();
    expect(cyberThemeAttribute(undefined)).toBeUndefined();
  });
});
