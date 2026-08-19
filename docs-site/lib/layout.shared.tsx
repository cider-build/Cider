import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { CiderLogo } from '@/components/logo';
import { gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <CiderLogo />,
      url: '/',
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      {
        text: 'Console',
        url: 'https://app.cider.build',
        external: true,
      },
    ],
  };
}
