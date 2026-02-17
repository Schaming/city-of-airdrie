import { ListBlockData } from '@/types/bylawBlocks'

type Props = {
  block: ListBlockData
}

export function ListRenderer({ block }: Props) {
  const { listType, kind, listStyleType, items } = block
  if (!items || items.length === 0) return null

  const resolvedKind = kind ?? (listType === 'number' ? 'ordered' : 'unordered')
  const Tag = resolvedKind === 'ordered' ? 'ol' : 'ul'
  const listClass =
    resolvedKind === 'ordered'
      ? `list-${listStyleType ?? 'decimal'}`
      : 'list-disc'

  return (
    <Tag className={`mb-2 ml-6 ${listClass}`}>
      {items.map((item, i) => (
        <li key={i} className="mb-1">
          {item.text}
        </li>
      ))}
    </Tag>
  )
}
