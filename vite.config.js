import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator'

const appVersion = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')
).version;

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    obfuscatorPlugin({
      apply: 'build',
      exclude: [/node_modules/, /electron/],
      options: {
        compact: true,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.12,
        disableConsoleOutput: true,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        rotateStringArray: true,
        selfDefending: true,
        splitStrings: true,
        splitStringsChunkLength: 8,
        stringArray: true,
        stringArrayThreshold: 0.8,
      },
    }),
  ],
  build: {
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
            return 'vendor-core';
          }

          if (id.includes('@radix-ui') || id.includes('lucide-react')) {
            return 'vendor-ui';
          }

          if (id.includes('@tanstack/react-query') || id.includes('zod') || id.includes('lodash')) {
            return 'vendor-data';
          }

          if (id.includes('recharts') || id.includes('framer-motion') || id.includes('three')) {
            return 'vendor-visual';
          }

          return 'vendor-core';
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});