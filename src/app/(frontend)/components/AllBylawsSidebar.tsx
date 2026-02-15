'use client'

import { useState } from 'react'

type SidebarSubsection = {
  id: string | number
  slug: string
  code: string
  title: string
  level?: number
}

type SidebarBylaw = {
  id: number
  title: string | null
}

type SidebarSection = {
  id: string | number
  slug: string
  code: string
  title: string
  bylaw?: SidebarBylaw | null
  subsections: SidebarSubsection[]
}

type NavNode = SidebarSubsection & { level: number; children: NavNode[] }

function buildTree(subsections: SidebarSubsection[]): NavNode[] {
  const roots: NavNode[] = []
  const stack: NavNode[] = []

  subsections.forEach(sub => {
    const level = sub.level ?? 1
    const node: NavNode = { ...sub, level, children: [] }

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node)
    } else {
      roots.push(node)
    }

    stack.push(node)
  })

  return roots
}

type Props = {
  items: SidebarSection[]
}

const makeKey = (type: 'bylaw' | 'section' | 'sub', id: string | number) => `${type}:${id}`

function collectSubKeys(nodes: NavNode[]): [string, boolean][] {
  const pairs: [string, boolean][] = []
  nodes.forEach(node => {
    pairs.push([makeKey('sub', node.id), false])
    if (node.children.length > 0) {
      pairs.push(...collectSubKeys(node.children))
    }
  })
  return pairs
}

/** Group sections by parent bylaw (sections without bylaw go under key "none"). */
function groupByBylaw(
  items: SidebarSection[],
): Map<string, { bylaw: SidebarBylaw | null; sections: SidebarSection[] }> {
  const map = new Map<string, { bylaw: SidebarBylaw | null; sections: SidebarSection[] }>()
  items.forEach(item => {
    const key = item.bylaw?.id != null ? String(item.bylaw.id) : 'none'
    if (!map.has(key)) {
      map.set(key, { bylaw: item.bylaw ?? null, sections: [] })
    }
    map.get(key)!.sections.push(item)
  })
  return map
}

export function AllBylawsSidebar({ items }: Props) {
  const groups = groupByBylaw(items)

  const [openState, setOpenState] = useState<Record<string, boolean>>(() => {
    const pairs: [string, boolean][] = []
    groups.forEach((group, bylawKey) => {
      pairs.push([makeKey('bylaw', bylawKey === 'none' ? 'none' : Number(bylawKey)), false])
      group.sections.forEach(item => {
        pairs.push([makeKey('section', item.id), false])
        const tree = buildTree(item.subsections)
        tree.forEach(root => {
          pairs.push([makeKey('sub', root.id), false])
          if (root.children.length > 0) {
            pairs.push(...collectSubKeys(root.children))
          }
        })
      })
    })
    return Object.fromEntries(pairs)
  })

  const toggle = (key: string) => setOpenState(prev => ({ ...prev, [key]: !prev[key] }))

  const renderSubsection = (node: NavNode, depth: number) => {
    const key = makeKey('sub', node.id)
    const isOpen = openState[key] ?? false
    const hasChildren = node.children.length > 0

    return (
      <div key={node.id} className="space-y-1">
        <div className="flex items-center" style={{ marginLeft: `${depth * 12}px` }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-label={isOpen ? 'Collapse subsection' : 'Expand subsection'}
              className="mr-2 flex h-6 w-[25px] min-w-[25px] max-w-[25px] items-center justify-center rounded border text-xs"
            >
              {isOpen ? '−' : '+'}
            </button>
          ) : (
            <span className="mr-2 block h-6 w-[25px] min-w-[25px] max-w-[25px]" />
          )}

          <a href={`#${node.slug}`} className="hover:underline">
            {node.code} {node.title}
          </a>
        </div>

        {hasChildren && isOpen && (
          <div className="space-y-1">
            {node.children.map(child => renderSubsection(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-y-auto max-h-[calc(100vh-2rem)] pr-1 -mr-1">
      <nav className="text-sm space-y-3" aria-label="Table of Contents">
        {Array.from(groups.entries()).map(([bylawKey, { bylaw, sections }]) => {
          const bylawStateKey = makeKey('bylaw', bylawKey === 'none' ? 'none' : Number(bylawKey))
          const bylawOpen = openState[bylawStateKey] ?? false
          const hasSections = sections.length > 0
          const bylawTitle = bylaw?.title ?? 'Sections'

          return (
            <div key={bylawKey} className="space-y-1">
              {/* Level 1: Bylaw — + reveals sections */}
              <div className="flex items-center">
                {hasSections ? (
                  <button
                    type="button"
                    onClick={() => toggle(bylawStateKey)}
                    aria-label={bylawOpen ? 'Collapse bylaw sections' : 'Expand bylaw sections'}
                    className="mr-2 flex h-6 w-[25px] min-w-[25px] max-w-[25px] items-center justify-center rounded border text-xs"
                  >
                    {bylawOpen ? '−' : '+'}
                  </button>
                ) : (
                  <span className="mr-2 block h-6 w-[25px] min-w-[25px] max-w-[25px]" />
                )}

                <span className="font-semibold text-gray-900">{bylawTitle}</span>
              </div>

              {/* Level 2: Sections — + reveals subsections */}
              {hasSections && bylawOpen && (
                <div className="ml-2 space-y-1">
                  {sections.map(item => {
                    const sectionKey = makeKey('section', item.id)
                    const sectionOpen = openState[sectionKey] ?? false
                    const tree = buildTree(item.subsections)
                    const hasSubsections = tree.length > 0

                    return (
                      <div key={item.id} className="space-y-1">
                        <div className="flex items-center" style={{ marginLeft: '12px' }}>
                          {hasSubsections ? (
                            <button
                              type="button"
                              onClick={() => toggle(sectionKey)}
                              aria-label={
                                sectionOpen ? 'Collapse subsections' : 'Expand subsections'
                              }
                              className="mr-2 flex h-6 w-[25px] min-w-[25px] max-w-[25px] items-center justify-center rounded border text-xs"
                            >
                              {sectionOpen ? '−' : '+'}
                            </button>
                          ) : (
                            <span className="mr-2 block h-6 w-[25px] min-w-[25px] max-w-[25px]" />
                          )}

                          <a href={`#${item.slug}`} className="hover:underline">
                            {item.code} {item.title}
                          </a>
                        </div>

                        {/* Level 3: Subsections (nested under section) */}
                        {hasSubsections && sectionOpen && (
                          <div className="space-y-1">
                            {tree.map(root => renderSubsection(root, 2))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </div>
  )
}
