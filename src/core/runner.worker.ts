import { execute } from "./runtime";
self.onmessage = (e) => {
  try {
    self.postMessage({ run: execute(e.data) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
