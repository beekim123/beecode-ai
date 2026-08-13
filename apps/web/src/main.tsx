import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Beecode root element is missing");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </StrictMode>,
);
