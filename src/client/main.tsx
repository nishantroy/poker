import { APP_NAME } from "@shared/brand";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { installErrorReporting } from "./lib/report";

installErrorReporting();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
document.title = APP_NAME;
