import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { IBM_Plex_Mono, Montserrat } from 'next/font/google';
import type { Metadata } from 'next';

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-montserrat',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-mono',
});

export const metadata: Metadata = {
  title: {
    template: '%s | Cider docs',
    default: 'Cider docs',
  },
  description: 'Documentation for Cider: macOS virtual machines for development, CI, and agents.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen font-sans">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
