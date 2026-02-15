'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

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

type BylawListItem = { id: number; title: string | null }

const BASE_PATH = '/bylaws/browse'

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

const makeKey = (type: 'bylaw' | 'section' | 'sub', id: string | number) => `${type}:${id}`

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

function nodeContainsSlug(node: NavNode, slug: string): boolean {
  if (node.slug === slug) return true
  return node.children.some(child => nodeContainsSlug(child, slug))
}

function sectionContainsSlug(item: SidebarSection, slug: string): boolean {
  if (item.slug === slug) return true
  return (
    item.subsections.some(sub => sub.slug === slug) ||
    buildTree(item.subsections).some(root => nodeContainsSlug(root, slug))
  )
}

function setSubKeysOpen(nodes: NavNode[], slug: string, state: Record<string, boolean>): boolean {
  for (const node of nodes) {
    if (node.slug === slug) {
      state[makeKey('sub', node.id)] = true
      return true
    }
    if (node.children.length > 0 && setSubKeysOpen(node.children, slug, state)) {
      state[makeKey('sub', node.id)] = true
      return true
    }
  }
  return false
}

function collectAllSubKeys(nodes: NavNode[], state: Record<string, boolean>, value: boolean) {
  nodes.forEach(node => {
    state[makeKey('sub', node.id)] = value
    if (node.children.length > 0) collectAllSubKeys(node.children, state, value)
  })
}

function buildInitialOpenState(
  items: SidebarSection[],
  initialSectionSlug: string | null,
): Record<string, boolean> {
  const state: Record<string, boolean> = {}
  const groups = groupByBylaw(items)

  groups.forEach((group, bylawKey) => {
    const bylawStateKey = makeKey('bylaw', bylawKey === 'none' ? 'none' : Number(bylawKey))
    let bylawOpen = false

    group.sections.forEach(item => {
      const sectionKey = makeKey('section', item.id)
      const tree = buildTree(item.subsections)
      const isTargetSection = initialSectionSlug
        ? item.slug === initialSectionSlug || sectionContainsSlug(item, initialSectionSlug)
        : false

      state[sectionKey] = isTargetSection
      if (isTargetSection) bylawOpen = true
      tree.forEach(root => {
        collectAllSubKeys([root], state, false)
      })
      if (isTargetSection && initialSectionSlug) {
        tree.forEach(root => setSubKeysOpen([root], initialSectionSlug, state))
      }
    })

    state[bylawStateKey] = bylawOpen || group.sections.length === 0
  })

  return state
}

type Props = {
  items: SidebarSection[]
  initialSectionSlug?: string | null
  currentBylawId?: number | null
  bylawList?: BylawListItem[]
  /** Preloaded sections per bylaw (picker view). When set, no client fetch. */
  sectionsByBylawId?: Record<number, SidebarSection[]>
}

export function BylawsBrowseSidebar({
  items,
  initialSectionSlug,
  currentBylawId,
  bylawList = [],
  sectionsByBylawId: initialSectionsByBylawId = {},
}: Props) {
  const sectionsByBylawId = initialSectionsByBylawId
  const showBylawList = bylawList.length > 0
  const currentBylawSections =
    currentBylawId != null ? (sectionsByBylawId[currentBylawId] ?? []) : []

  const [openState, setOpenState] = useState<Record<string, boolean>>(() => {
    const pairs: [string, boolean][] = bylawList.map(b => [
      makeKey('bylaw', b.id),
      b.id === currentBylawId,
    ])
    if (currentBylawId != null && currentBylawSections.length > 0 && initialSectionSlug) {
      const sectionState = buildInitialOpenState(currentBylawSections, initialSectionSlug)
      Object.entries(sectionState).forEach(([k, v]) => {
        pairs.push([k, v])
      })
    } else if (currentBylawId != null && currentBylawSections.length > 0) {
      currentBylawSections.forEach(item => {
        pairs.push([makeKey('section', item.id), false])
        const tree = buildTree(item.subsections)
        tree.forEach(root => {
          pairs.push([makeKey('sub', root.id), false])
          const collect = (n: NavNode) => {
            n.children.forEach(c => {
              pairs.push([makeKey('sub', c.id), false])
              collect(c)
            })
          }
          collect(root)
        })
      })
    }
    return Object.fromEntries(pairs)
  })

  const toggle = (key: string) => setOpenState(prev => ({ ...prev, [key]: !prev[key] }))

  const sectionHref = (slug: string, bylawId?: number) => {
    if (currentBylawId != null && bylawId === currentBylawId) {
      return `#${slug}` as const
    }
    const bid = bylawId ?? currentBylawId
    if (bid != null) {
      return `${BASE_PATH}?bylaw=${bid}&section=${encodeURIComponent(slug)}`
    }
    return `${BASE_PATH}?section=${encodeURIComponent(slug)}`
  }

  const isAnchor = (slug: string, bylawId?: number) =>
    currentBylawId != null && (bylawId ?? currentBylawId) === currentBylawId

  const renderSubsection = (node: NavNode, depth: number, pickerBylawId?: number) => {
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
              className="mr-2 flex h-6 w-[25px] min-w-[25px] max-w-[25px] items-center justify-center rounded border text-xs shrink-0"
            >
              {isOpen ? '−' : '+'}
            </button>
          ) : (
            <span className="mr-2 block h-6 w-[25px] min-w-[25px] max-w-[25px] shrink-0" />
          )}

          {isAnchor(node.slug, pickerBylawId) ? (
            <a href={`#${node.slug}`} className="hover:underline">
              {node.code} {node.title}
            </a>
          ) : (
            <Link href={sectionHref(node.slug, pickerBylawId)} className="hover:underline">
              {node.code} {node.title}
            </Link>
          )}
        </div>

        {hasChildren && isOpen && (
          <div className="space-y-1">
            {node.children.map(child => renderSubsection(child, depth + 1, pickerBylawId))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-y-auto max-h-[calc(100vh-2rem)] pr-1 -mr-1">
      <nav className="text-sm space-y-3" aria-label="Table of Contents">
        {/* {currentBylawId != null && (
          <div className="mb-2 pb-2 border-b border-gray-200">
            <Link
              href={BASE_PATH}
              className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs font-medium"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Choose another bylaw
            </Link>
            {bylawList.length > 1 && (
              <ul className="mt-2 space-y-1">
                {bylawList
                  .filter(b => b.id !== currentBylawId)
                  .map(b => (
                    <li key={b.id}>
                      <Link
                        href={`${BASE_PATH}?bylaw=${b.id}`}
                        className="text-gray-600 hover:text-gray-900 hover:underline"
                      >
                        {b.title ?? `Bylaw ${b.id}`}
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )} */}

        {showBylawList &&
          [...bylawList].reverse().map(b => {
            const bylawStateKey = makeKey('bylaw', b.id)
            const bylawOpen = openState[bylawStateKey] ?? false
            const sections = sectionsByBylawId[b.id] ?? []
            const hasSections = sections.length > 0
            const bylawTitle = b.title ?? `Bylaw ${b.id}`

            return (
              <div key={b.id} className="space-y-1">
                <div className="flex items-center">
                  {hasSections ? (
                    <button
                      type="button"
                      onClick={() => toggle(bylawStateKey)}
                      aria-label={bylawOpen ? 'Collapse bylaw sections' : 'Expand bylaw sections'}
                      className="mr-2 flex h-6 w-[25px] min-w-[25px] max-w-[25px] items-center justify-center rounded border text-xs shrink-0"
                    >
                      {bylawOpen ? '−' : '+'}
                    </button>
                  ) : (
                    <span className="mr-2 block h-6 w-[25px] min-w-[25px] max-w-[25px] shrink-0" />
                  )}
                  <Link
                    href={`${BASE_PATH}?bylaw=${b.id}`}
                    className="font-semibold text-gray-900 hover:underline"
                  >
                    {bylawTitle}
                  </Link>
                </div>
                {bylawOpen && hasSections && (
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
                                className="mr-2 flex h-6 w-[25px] min-w-[25px] max-w-[25px] items-center justify-center rounded border text-xs shrink-0"
                              >
                                {sectionOpen ? '−' : '+'}
                              </button>
                            ) : (
                              <span className="mr-2 block h-6 w-[25px] min-w-[25px] max-w-[25px] shrink-0" />
                            )}
                            {isAnchor(item.slug, b.id) ? (
                              <a href={`#${item.slug}`} className="hover:underline">
                                {item.code} {item.title}
                              </a>
                            ) : (
                              <Link href={sectionHref(item.slug, b.id)} className="hover:underline">
                                {item.code} {item.title}
                              </Link>
                            )}
                          </div>
                          {hasSubsections && sectionOpen && (
                            <div className="space-y-1">
                              {tree.map(root => renderSubsection(root, 2, b.id))}
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
