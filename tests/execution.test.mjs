import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";

const source = transformSync(
  await readFile(new URL("../src/canvas/state/ExecutionProvider.tsx", import.meta.url), "utf8"),
  { loader: "tsx", format: "cjs", target: "es2022" }
).code;

function createHarness() {
  let entries = {};
  let timerId = 0;
  const timers = new Map();
  const listeners = new Map();
  const sent = [];
  const toasts = [];
  const parent = { postMessage: (message) => sent.push(message) };
  const react = {
    createContext: () => ({ Provider: {} }),
    useCallback: (callback) => callback,
    useContext: () => null,
    useEffect: (effect) => effect(),
    useMemo: (factory) => factory(),
    useRef: (current) => ({ current }),
    useState: (initial) => [initial, (next) => { entries = next; }],
    createElement: (_type, props) => props.value
  };
  const window = {
    parent,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener() {},
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: () => 1,
    clearInterval() {}
  };
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require(name) {
      if (name === "react") return react;
      if (name === "../../shared/messages") {
        return { MSG: { progress: "progress", runPrompt: "run", cancelRun: "cancel" } };
      }
      if (name === "./ToastProvider") return { useToast: () => ({ pushToast: (text) => toasts.push(text) }) };
      throw new Error(`Unexpected import: ${name}`);
    },
    React: react,
    window,
    Date
  });
  vm.runInContext(source, context, { filename: "src/canvas/state/ExecutionProvider.tsx" });
  const api = module.exports.ExecutionProvider({ children: null, embedded: true });
  return {
    api,
    timers,
    sent,
    toasts,
    get entries() { return entries; },
    progress(requestId, stage, promptId = "prompt") {
      listeners.get("message")({
        source: parent,
        data: { type: "progress", requestId, promptId, canvasId: "canvas", stage, message: stage }
      });
    }
  };
}

function request(requestId, promptId = "prompt") {
  return { requestId, promptId, canvasId: "canvas", title: requestId, prompt: "a cat", references: [] };
}

test("late progress cannot replace a newer run or schedule its removal", () => {
  const harness = createHarness();
  harness.api.runPrompt(request("old"));
  harness.progress("old", "captured");
  harness.api.runPrompt(request("new"));
  const timerCount = harness.timers.size;
  harness.progress("old", "captured");
  assert.equal(harness.entries.prompt.requestId, "new");
  assert.equal(harness.entries.prompt.tone, "working");
  assert.equal(harness.timers.size, timerCount);
});

test("unknown progress cannot create an execution or an error notification", () => {
  const harness = createHarness();
  harness.progress("unknown", "failed");
  assert.equal(Object.keys(harness.entries).length, 0);
  assert.equal(harness.toasts.length, 0);
  assert.equal(harness.timers.size, 0);
});

test("matching progress still completes the active request and starts the queue", () => {
  const harness = createHarness();
  harness.api.runPrompt(request("first"));
  harness.api.runPrompt(request("second", "other-prompt"));
  harness.progress("first", "captured");
  assert.equal(harness.entries.prompt.tone, "done");
  const next = [...harness.timers.values()].find((timer) => timer.delay === 60);
  assert.ok(next);
  next.callback();
  assert.equal(harness.sent.at(-1).requestId, "second");
  harness.progress("second", "captured", "other-prompt");
  assert.equal(harness.entries["other-prompt"].tone, "done");
});
