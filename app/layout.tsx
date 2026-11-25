import type { Metadata } from 'next';
import { Suspense } from 'react';
import localFont from 'next/font/local';
import './globals.css';
import Navbar from '@/components/Navbar';
import AuroraBackdrop from '@/components/reactbits/AuroraBackdrop';
import ClickSpark from '@/components/reactbits/ClickSpark';
import { ToastProvider } from '@/components/ToastProvider';
import AuthWatcher from '@/components/AuthWatcher';

// Self-hosted (SIL OFL) so production builds don't need to reach Google Fonts.
const geist = localFont({
  src: './fonts/GeistLatin.woff2',
  weight: '100 900',
  variable: '--font-geist-sans',
  display: 'swap',
});
const geistMono = localFont({
  src: './fonts/GeistMonoLatin.woff2',
  weight: '100 900',
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'API Manager',
  description: '简单的 API Key 管理工具',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" style={{ backgroundColor: '#f5f7fb', colorScheme: 'light' }}>
      <body
        className={`${geist.variable} ${geistMono.variable} bg-grid`}
        style={{
          backgroundColor: 'var(--background, #f5f7fb)',
          color: 'var(--foreground, #0f172a)',
          minHeight: '100vh',
          fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
          position: 'relative',
        }}
      >
        <ToastProvider>
          <AuthWatcher />
          <ClickSpark sparkColor="#4f46e5" sparkSize={8} sparkRadius={20} sparkCount={8} duration={360}>
            <AuroraBackdrop />
            <Suspense fallback={<div style={{ height: 56, borderBottom: '1px solid var(--border)' }} />}>
              <Navbar />
            </Suspense>
            <main
              style={{
                position: 'relative',
                zIndex: 1,
                maxWidth: 1200,
                margin: '0 auto',
                padding: '28px 20px 56px',
              }}
            >
              {children}
            </main>
          </ClickSpark>
        </ToastProvider>

        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </body>
    </html>
  );
}
