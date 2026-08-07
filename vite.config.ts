import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: {
    target: 'es2022',
    // 디버그 패널은 import.meta.env.DEV 가드 안에서만 로드되므로
    // 프로덕션 빌드에서 tree-shaking 된다. (§19)
    sourcemap: false,
  },
});
