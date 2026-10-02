import * as React from "react";
import { renderToString } from "react-dom/server";
import { makeScenario } from "./scenarios";
export function html(name: string) { return renderToString(makeScenario(name).node); }
