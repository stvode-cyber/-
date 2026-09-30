/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VAPID_PUBLIC_KEY?: string
  readonly VITE_BUILD_MODE: 'desktop' | 'mobile';
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
