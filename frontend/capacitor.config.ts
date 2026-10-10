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
  },
};

export default config;
