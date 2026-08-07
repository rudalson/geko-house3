import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // §0-4: systems/ 와 core/ 는 Three.js 를 import 하지 않으므로
    // WebGL 컨텍스트가 없는 node 환경에서 그대로 돌아간다.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'default',
  },
});
