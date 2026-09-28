import type { ReactNode } from "react";

import { useCyberProfile } from "../state/cyberProfile";
import { cyberThemeAttribute } from "./cyberTheme";

/**
 * Cyber Defense theme scope.
 *
 * Wraps every `/game` route so the equipped Tower theme is expressed once, as a
 * `data-cyber-theme` attribute on the Cyber Defense root. CSS resolves the
 * theme's `--cyber-*` tokens from that attribute, which lets a purchased theme
 * visibly restyle the dashboard, board, Tower and briefing without touching the
 * rest of the application.
 *
 * The attribute is purely cosmetic: it never changes simulation values.
 */
export interface CyberDefenseRootProps {
  children: ReactNode;
}

export default function CyberDefenseRoot({ children }: CyberDefenseRootProps) {
  const profile = useCyberProfile();
  const theme = profile?.equipped_theme ?? null;
  return (
    <div className="cyber-theme-root" data-cyber-theme={cyberThemeAttribute(theme)}>
      {children}
    </div>
  );
}
