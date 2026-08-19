"use strict";
/**
 * Next's `server-only` package throws when loaded outside the App Router.
 * Off-web tsx workers still import server modules (EDI poll → supplier orders).
 * Preload this before the worker entry: NODE_OPTIONS=--require ./scripts/workers/stubServerOnly.cjs
 */
const Module = require("module");
const originalLoad = Module._load;
Module._load = function stubServerOnly(request, parent, isMain) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad.apply(this, arguments);
};
