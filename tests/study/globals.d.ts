// Globals provided by tests/study/run.js
declare function t(name: string, fn: () => unknown): Promise<void>;
declare const assert: { fail(m?: string): never; ok(v: unknown, m?: string): void; notEqual(a: unknown, b: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void; match(s: string, r: RegExp, m?: string): void; doesNotMatch(s: string, r: RegExp, m?: string): void };
