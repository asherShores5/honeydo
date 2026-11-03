import "./demo/boot"; // first: may swap storage and network for the guest demo
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { registerServiceWorker } from "./registerSw";
import { startDeepLinks } from "./openRequests";
import "./styles.css";

startDeepLinks();
void registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
