import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { getLayoutTabs } from 'fumadocs-ui/layouts/shared';
import { baseOptions } from '@/lib/layout.shared';
import { BookOpen } from 'lucide-react';

export default function Layout({ children }: LayoutProps<'/'>) {
  const tree = source.getPageTree();
  const rootTabs = getLayoutTabs(tree);
  const docsUrls = new Set(
    source
      .getPages()
      .map((page) => page.url)
      .filter((url) => !url.startsWith('/cli') && !url.startsWith('/api-reference')),
  );

  return (
    <DocsLayout
      tree={tree}
      {...baseOptions()}
      tabs={[
        {
          title: 'Documentation',
          description: 'Concepts, sandboxes, servers, and nodes',
          url: '/',
          icon: <BookOpen />,
          urls: docsUrls,
        },
        ...rootTabs,
      ]}
      sidebar={{ defaultOpenLevel: 1 }}
    >
      {children}
    </DocsLayout>
  );
}
