import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Loads the HiGHS solver WebAssembly as a base64 string so the whole app can ship as one HTML file.
function highsWasmB64(): Plugin {
  const id = 'virtual:highs-wasm';
  return {
    name: 'highs-wasm-b64',
    resolveId(source) {
      if (source === id) return '\0' + id;
    },
    load(source) {
      if (source === '\0' + id) {
        const path = require.resolve('highs/runtime');
        const b64 = fs.readFileSync(path).toString('base64');
        return `export default ${JSON.stringify(b64)};`;
      }
    },
  };
}

// highs.mjs points at "highs.wasm" next to itself, which Vite would inline a second time.
// We hand the bytes over ourselves (instantiateWasm), so drop that reference.
function stripHighsWasmUrl(): Plugin {
  return {
    name: 'strip-highs-wasm-url',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('highs/build/highs')) {
        return code.replace(/new URL\(\s*["']highs\.wasm["']\s*,\s*import\.meta\.url\s*\)\.href/g, '"highs.wasm"');
      }
    },
  };
}

export default defineConfig({
  plugins: [stripHighsWasmUrl(), react(), highsWasmB64(), viteSingleFile()],
  worker: { format: 'iife', plugins: () => [stripHighsWasmUrl()] },
  build: { chunkSizeWarningLimit: 20000, assetsInlineLimit: 100000000 },
});
