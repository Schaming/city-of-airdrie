import { Block } from 'payload'

export const ListBlock = {
  slug: 'list',
  fields: [
    { name: 'kind', type: 'select', options: ['ordered', 'unordered'], required: true },
    {
      name: 'listStyleType',
      type: 'select',
      options: [
        { label: 'Decimal', value: 'decimal' },
        { label: 'Upper Roman', value: 'upper-roman' },
        { label: 'Lower Roman', value: 'lower-roman' },
      ],
      defaultValue: 'decimal',
      admin: {
        description: 'Numbering style for ordered lists.',
        condition: (_data, siblingData) => (siblingData as { kind?: string })?.kind === 'ordered',
      },
    },
    { name: 'items', type: 'array', fields: [{ name: 'text', type: 'text', required: true }] },
  ],
} as const satisfies Block
