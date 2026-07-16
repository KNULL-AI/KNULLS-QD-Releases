import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator'

// https://vite.dev/config/
export default defineConfig({
  base: "./",
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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});