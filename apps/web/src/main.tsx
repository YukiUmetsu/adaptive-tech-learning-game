import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import AuthRoot from "./auth/AuthRoot";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root is missing from index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <AuthRoot>
        <App />
      </AuthRoot>
    </BrowserRouter>
  </StrictMode>,
);
