import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['{backend,frontend}/src/**/*.test.{js,jsx}'],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10000,
  },
});
