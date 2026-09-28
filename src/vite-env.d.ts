/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** アクセスゲートのパスワードハッシュ（PBKDF2-SHA256, hex）。ビルド時に注入される。 */
  readonly VITE_ACCESS_PW_HASH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
