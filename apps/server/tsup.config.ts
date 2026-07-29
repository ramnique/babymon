import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // Bundle everything (workspace TS sources and npm deps alike) so the
  // runtime image is just Node + one file — no node_modules.
  noExternal: [/.*/],
  // Bundled CJS deps (ws) require() node builtins; give ESM output a shim.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
