import {readFileSync} from 'node:fs';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  base: './',
  esbuild: {jsx: 'automatic'},
  plugins: [{
    name: 'bundle-dom-probe',
    apply: 'build',
    generateBundle() {
      for (const file of ['parser.js', 'probe.js', 'observe.js']) {
        const source = readFileSync(new URL('../research/m2-prototype/' + file, import.meta.url), 'utf8');
        this.emitFile({type: 'asset', fileName: 'm2-' + file, source});
      }
    },
  }],
  test: {environment: 'jsdom', include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']},
});
