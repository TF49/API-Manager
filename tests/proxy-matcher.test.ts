import { describe, expect, it } from 'vitest';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config } from '@/proxy';
import nextConfig from '@/next.config';

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig, url });

describe('proxy matcher', () => {
  it('runs on app pages and API routes', () => {
    for (const url of ['/', '/sites', '/sites/3', '/history', '/login', '/api/sites', '/api/auth/me']) {
      expect(matches(url), url).toBe(true);
    }
  });

  it('never intercepts Next.js internals (HMR socket, dev overlay, static assets)', () => {
    for (const url of [
      '/_next/webpack-hmr',
      '/_next/webpack-hmr?id=abc',
      '/_next/static/chunks/main.js',
      '/_next/image?url=x',
      '/__nextjs_original-stack-frames',
      '/__nextjs_source-map',
      '/favicon.ico',
      '/next.svg',
    ]) {
      expect(matches(url), url).toBe(false);
    }
  });
});
