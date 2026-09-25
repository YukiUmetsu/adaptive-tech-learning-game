import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import AuthRoot from "./auth/AuthRoot";
import { clearStaleServiceWorkers } from "./lib/serviceWorker";
import { unlockAudioOnFirstGesture } from "./state/sound";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root is missing from index.html");
}

// In development, drop any service worker left over from an earlier production
// build served on this origin. A stale worker would serve an old app shell whose
// hashed assets no longer exist, which looks like a blank page on refresh.
clearStaleServiceWorkers();

// Prime audio on the first interaction so timer-driven game cues are audible
// even under a strict browser autoplay policy.
unlockAudioOnFirstGesture();

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <AuthRoot>
        <App />
      </AuthRoot>
    </BrowserRouter>
  </StrictMode>,
);
