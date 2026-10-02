import * as React from "react";
import { hydrateRoot } from "react-dom/client";
import { makeScenario } from "./scenarios";
const name = (window as any).__SCEN__ as string;
const s = makeScenario(name);
(window as any).__api = s.api;
hydrateRoot(document.getElementById("root")!, <React.StrictMode>{s.node}</React.StrictMode>, { onRecoverableError: (e: any) => { ((window as any).__recoverable = (window as any).__recoverable || []).push(String(e && e.message || e)); } });
