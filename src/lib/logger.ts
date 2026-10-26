/**
 * Central console shim — the only module allowed to call the console
 * (the `no-console` rule is disabled for this file alone). All debug
 * diagnostics (docling client + worker) route through `logger` so the
 * eslint baseline stays at 0 and output can be gated or rerouted here
 * later (e.g. `import.meta.env.DEV`, ring buffer, remote logs).
 */
/* eslint-disable no-console */
export const logger = {
  debug: (...args: unknown[]) => console.debug(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
