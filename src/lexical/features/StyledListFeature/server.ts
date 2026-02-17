import { createServerFeature, createNode } from '@payloadcms/richtext-lexical';
import { StyledListNode } from '@/lexical/nodes/StyledListNode';

export const StyledListFeature = createServerFeature({
  key: 'styledList',
  feature: () => ({
    ClientFeature: '@/lexical/features/StyledListFeature/client#StyledListFeatureClient',
    nodes: [createNode({ node: StyledListNode })],
  }),
});
