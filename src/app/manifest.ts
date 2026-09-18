import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Central de Suporte',
    short_name: 'Central',
    description: 'Atendimento interno de TI, simples e próximo.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f5f7f8',
    theme_color: '#176b57',
    lang: 'pt-BR',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
