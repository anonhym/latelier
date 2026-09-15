import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          resolve: {
            alias: {
              '@shared': path.resolve(__dirname, 'shared'),
            },
          },
          build: {
            // Vite 8 bundles with Rolldown, so this is `rolldownOptions`, not
            // `rollupOptions`. The old key is silently ignored — which bundles
            // better-sqlite3 into the ESM main chunk and blows up at boot with
            // "__filename is not defined".
            rolldownOptions: {
              external: ['better-sqlite3', 'mongodb', 'bson', 'zod'],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          resolve: {
            alias: {
              '@shared': path.resolve(__dirname, 'shared'),
            },
          },
          build: {
            rolldownOptions: {
              output: {
                format: 'cjs',
                entryFileNames: '[name].cjs',
              },
            },
          },
        },
      },
    }),
  ],
});
