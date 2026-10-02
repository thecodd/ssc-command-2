"use client";
import { createContext } from "react";
import type { PracticeApi } from "@/lib/practice/api";
import { livePracticeApi } from "./liveApi";
/** Defaults to the live API. Fixture hosts (tests/fixtures, dev-only preview) provide an in-memory fake instead. */
export const PracticeApiCtx = createContext<PracticeApi>(livePracticeApi);
