"use client";
import { createContext } from "react";
import type { RevisionApi } from "@/lib/revision/api";
import { liveRevisionApi } from "./liveApi";
/** Defaults to the live API. Fixture hosts (tests/fixtures, dev-only preview) provide an in-memory fake. */
export const RevisionApiCtx = createContext<RevisionApi>(liveRevisionApi);
