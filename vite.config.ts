import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: {
    target: 'es2022',
    // 디버그 패널은 import.meta.env.DEV 가드 안에서만 로드되므로
    // 프로덕션 빌드에서 tree-shaking 된다. (§19)
    sourcemap: false,
    rollupOptions: {
      output: {
        /**
         * Three.js 를 별도 청크로 뺀다.
         *
         * 전체 바이트가 줄지는 않는다 — 게임은 첫 화면부터 Three.js 가 필요해서
         * 지연 로드할 여지가 없다. 얻는 건 **캐시 분리**다. 이 저장소의 변경은
         * 거의 전부 게임 코드 쪽인데, 한 덩어리로 묶어 두면 상수 하나만 고쳐도
         * 550 kB 를 다시 받게 된다. 나눠 두면 30 kB 남짓만 새로 받는다.
         */
        manualChunks: { three: ['three'] },
      },
    },
    // three 청크 하나가 500 kB 를 넘는 건 구조상 불가피하다. 경고를 켜 두면
    // 매 빌드마다 조치할 수 없는 메시지가 나와서 진짜 경고를 가린다.
    chunkSizeWarningLimit: 600,
  },
});
