import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aie.assistant',
  appName: '绿角犀',
  webDir: 'mobile-dist',
  server: {
    androidScheme: 'http', // 用 http:// 加载 WebView，避免调 http API 时 Mixed Content
    allowUntrustedCertificates: true, // 开发调试：接受自签名证书（云端 Let's Encrypt 可能有兼容性问题）
  },
  android: {
    allowMixedContent: true,
    allowUntrustedCertificates: true,
    usesCleartextTraffic: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#1e3a5f',
      androidScaleType: 'CENTER_CROP',
    },
    // 禁 CapacitorHttp 原生拦截 — 让 WebView 自己处理 fetch
    // 原生 OkHttp 对 HTTP cleartext 有额外限制，导致 fetch() 报 "Failed to fetch"
    CapacitorHttp: {
      enabled: false,
    },
  },
};

export default config;
