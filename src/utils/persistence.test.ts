import test from "node:test";
import assert from "node:assert/strict";
import { loadExperiments, saveExperiments, type SavedExperiment } from "./persistence";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
  },
});

test("persistence loads empty state for absent or malformed data", () => {
  store.clear();
  assert.deepEqual(loadExperiments(), []);
  store.set("seo-strategy-lab-v1", "{broken");
  assert.deepEqual(loadExperiments(), []);
  store.set("seo-strategy-lab-v1", JSON.stringify({ nope: true }));
  assert.deepEqual(loadExperiments(), []);
});

test("persistence round-trips valid experiments and filters malformed records", () => {
  store.clear();
  const item: SavedExperiment = {
    id: "test-1", name: "Test", query: "camera", intent: "informational",
    pages: [], savedAt: "2026-01-01T00:00:00.000Z",
  };
  saveExperiments([item]);
  store.set("seo-strategy-lab-v1", JSON.stringify([item, { id: 3, name: "bad" }]));
  assert.deepEqual(loadExperiments(), [item]);
});

test("persistence reports unavailable storage on save", () => {
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: () => { throw new Error("quota"); }, getItem: () => null } });
  try { assert.throws(() => saveExperiments([]), /Could not save in this browser/); }
  finally { Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original }); }
});
