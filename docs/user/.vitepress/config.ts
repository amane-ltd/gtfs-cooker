import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'GTFS-cooker',
  description: 'GTFS to GeoJSON converter — User Guide',
  base: '/gtfs-cooker/docs/',
  outDir: '../../dist-docs',
  cleanUrls: true,
  head: [
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=download' }],
  ],

  locales: {
    ja: {
      label: '日本語',
      lang: 'ja',
      themeConfig: {
        nav: [
          { text: 'ホーム', link: '/ja/' },
          { text: 'アプリを開く', link: 'https://amane-ltd.github.io/gtfs-cooker/' },
        ],
        sidebar: [
          {
            text: 'ガイド',
            items: [
              { text: '概要', link: '/ja/' },
              { text: '使い方', link: '/ja/getting-started' },
              { text: '機能一覧', link: '/ja/features' },
              { text: 'Matching（乗降実績の結合）', link: '/ja/matching' },
              { text: 'ファイル定義', link: '/ja/file-definitions' },
            ],
          },
        ],
        outline: { label: '目次' },
        docFooter: { prev: '前のページ', next: '次のページ' },
      },
    },
    en: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Open App', link: 'https://amane-ltd.github.io/gtfs-cooker/' },
        ],
        sidebar: [
          {
            text: 'Guide',
            items: [
              { text: 'Overview', link: '/en/' },
              { text: 'Getting Started', link: '/en/getting-started' },
              { text: 'Features', link: '/en/features' },
              { text: 'Matching (Ridership)', link: '/en/matching' },
              { text: 'File Definitions', link: '/en/file-definitions' },
            ],
          },
        ],
      },
    },
  },

  themeConfig: {
    socialLinks: [
      { icon: 'github', link: 'https://github.com/amane-ltd/gtfs-cooker' },
    ],
  },
});
