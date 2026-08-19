import { generateFiles } from 'fumadocs-openapi';
import { openapi } from '../lib/openapi';

void generateFiles({
  input: openapi,
  output: './content/docs/api-reference/endpoints',
  per: 'operation',
  groupBy: 'tag',
  includeDescription: true,
  meta: { folderStyle: 'folder' },
});
