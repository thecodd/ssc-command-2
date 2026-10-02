import * as React from "react";
// React.cache dedupes calls within one server request. Typed via a cast because not every @types/react version exposes it.
type Fn<A extends unknown[], R> = (...a: A) => R;
export const cache: <A extends unknown[], R>(fn: Fn<A, R>) => Fn<A, R> = (React as unknown as { cache?: <A extends unknown[], R>(fn: Fn<A, R>) => Fn<A, R> }).cache ?? ((fn) => fn);
