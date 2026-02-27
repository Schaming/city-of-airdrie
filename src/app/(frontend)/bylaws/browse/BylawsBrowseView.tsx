'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import type {
  BylawSubsection,
  SectionWithSubsections,
  SearchResult,
} from '../../components/AllBylawsView'
import { BlocksRenderer } from '../../components/BlocksRender'
import {
  ReferenceSidebarProvider,
  useReferenceSidebar,
} from '../../components/ReferenceSidebarContext'
import { ReferenceSidebar } from '../../components/ReferenceSidebar'
import { ReferenceDrawer } from '../../components/ReferenceDrawer'
import { Search, Loader2, Menu, X } from 'lucide-react'
import Link from 'next/link'
import { BylawsBrowseSidebar } from './BylawsBrowseSidebar'

const BASE_PATH = '/bylaws/browse'
const AI_SEARCH_STORAGE_KEY = 'bylaws-browse-ai-search'

type StoredAiSearch = {
  searchQuery: string
  searchResults: SearchResult[]
  aiAnswer: string | null
  position?: { x: number; y: number }
}

export type BylawListItem = { id: number; title: string | null }

export type SidebarSectionItem = {
  id: string | number
  slug: string
  code: string
  title: string
  bylaw?: { id: number; title: string | null } | null
  subsections: { id: string | number; slug: string; code: string; title: string; level?: number }[]
}

type Props = {
  bylawList: BylawListItem[]
  sectionsWithSubsections?: SectionWithSubsections[]
  sectionsByBylawId?: Record<number, SidebarSectionItem[]>
  initialSectionSlug?: string | null
  currentBylawId?: number | null
  error?: string
}

type SearchFormProps = {
  searchQuery: string
  onQueryChange: (nextValue: string) => void
  onSubmit: (e: React.FormEvent) => void
  isSearching: boolean
  className?: string
}

function SubsectionArticle({ sub }: { sub: BylawSubsection }) {
  const { selectAmendment } = useReferenceSidebar()

  return (
    <article
      id={sub.slug}
      className={`scroll-mt-[13rem] lg:scroll-mt-[11rem] ${sub.level && sub.level > 1 ? 'ml-6 border-l pl-4' : ''}`}
    >
      <h3
        className={sub.level === 1 ? 'text-lg font-semibold mb-2' : 'text-base font-semibold mb-2'}
      >
        {sub.code} {sub.title}
      </h3>

      <BlocksRenderer blocks={sub.content ?? []} />

      {sub.amendments && sub.amendments.length > 0 && (
        <div className="mt-3 pt-2 border-t border-gray-200">
          <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
            Amendments:{' '}
          </span>
          {sub.amendments.map((amendment, i) => (
            <span key={amendment.id}>
              {i > 0 && ', '}
              <button
                onClick={() => selectAmendment(amendment)}
                className="text-sm text-amber-700 hover:text-amber-900 hover:underline"
              >
                {amendment.title}
              </button>
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

function SearchForm({
  searchQuery,
  onQueryChange,
  onSubmit,
  isSearching,
  className,
}: SearchFormProps) {
  return (
    <form onSubmit={onSubmit} className={`relative w-full ${className ?? ''}`}>
      <input
        type="text"
        placeholder="Ask a question about the bylaws (e.g. 'fences in backyards')..."
        className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={searchQuery}
        maxLength={200}
        onChange={e => onQueryChange(e.target.value)}
      />
      <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-500" />
      <button
        type="submit"
        disabled={isSearching}
        className="absolute right-2 top-1.5 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
      </button>
      <p className="mt-2 text-xs text-gray-600">
        This is an AI-powered search that processes the bylaws in real time, so it may take a few
        seconds to return results.
      </p>
    </form>
  )
}

export function BylawsBrowseView({
  bylawList,
  sectionsWithSubsections = [],
  sectionsByBylawId = {},
  initialSectionSlug,
  currentBylawId,
  error,
}: Props) {
  const isPicker = !sectionsWithSubsections.length || currentBylawId == null

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [aiAnswer, setAiAnswer] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [lastEmptyQuery, setLastEmptyQuery] = useState('')
  const [position, setPosition] = useState({ x: 20, y: 150 })
  const positionRef = useRef(position)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [tocOpen, setTocOpen] = useState(false)

  // Restore AI search from sessionStorage after navigation / reload
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = sessionStorage.getItem(AI_SEARCH_STORAGE_KEY)
      if (!raw) return
      const stored = JSON.parse(raw) as StoredAiSearch
      if (!stored || typeof stored.searchQuery !== 'string') return
      setSearchQuery(stored.searchQuery)
      setSearchResults(Array.isArray(stored.searchResults) ? stored.searchResults : [])
      setAiAnswer(stored.aiAnswer ?? null)
      setHasSearched(true)
      if (
        stored.position &&
        typeof stored.position.x === 'number' &&
        typeof stored.position.y === 'number'
      ) {
        const pos = { x: stored.position.x, y: stored.position.y }
        setPosition(pos)
        positionRef.current = pos
      }
    } catch {
      sessionStorage.removeItem(AI_SEARCH_STORAGE_KEY)
    }
  }, [])

  useEffect(() => {
    if (!initialSectionSlug) return
    const el = document.getElementById(initialSectionSlug)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [initialSectionSlug])

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.drag-handle')) {
      setIsDragging(true)
      setDragOffset({
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      })
    }
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const next = {
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y,
        }
        positionRef.current = next
        setPosition(next)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      try {
        const raw = sessionStorage.getItem(AI_SEARCH_STORAGE_KEY)
        if (raw) {
          const stored = JSON.parse(raw) as StoredAiSearch
          if (stored && typeof stored.searchQuery === 'string') {
            sessionStorage.setItem(
              AI_SEARCH_STORAGE_KEY,
              JSON.stringify({ ...stored, position: positionRef.current }),
            )
          }
        }
      } catch {
        // ignore
      }
    }

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragOffset])

  useEffect(() => {
    let timeout: NodeJS.Timeout
    if (hasSearched && searchResults.length === 0 && !isSearching) {
      timeout = setTimeout(() => {
        setHasSearched(false)
        setAiAnswer(null)
      }, 5000)
    }
    return () => clearTimeout(timeout)
  }, [hasSearched, searchResults.length, isSearching])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return

    setIsSearching(true)
    setHasSearched(true)
    setAiAnswer(null)
    try {
      const res = await fetch(`/api/semantic-search?q=${encodeURIComponent(searchQuery)}`)
      const data = await res.json()
      const results = (data.results || []) as SearchResult[]
      const sorted = results.sort((a, b) => b.similarity - a.similarity)
      setSearchResults(sorted)
      const answer = data.answer || null
      setAiAnswer(answer)
      try {
        sessionStorage.setItem(
          AI_SEARCH_STORAGE_KEY,
          JSON.stringify({
            searchQuery: searchQuery.trim(),
            searchResults: sorted,
            aiAnswer: answer,
            position: { x: position.x, y: position.y },
          } satisfies StoredAiSearch),
        )
      } catch {
        // ignore storage errors
      }
      if (results.length === 0) {
        setLastEmptyQuery(searchQuery)
      }
    } catch (err) {
      console.error('Search error:', err)
    } finally {
      setIsSearching(false)
    }
  }

  const sidebarItems = sectionsWithSubsections.map(({ section, subsections }) => ({
    id: section.id,
    slug: section.slug,
    code: section.code,
    title: section.title,
    bylaw: section.bylaw ?? undefined,
    subsections,
  }))

  // Slugs currently on the page (current bylaw's sections + subsections) for anchor links
  const currentPageSlugs = useMemo(() => {
    const slugs = new Set<string>()
    for (const { section, subsections } of sectionsWithSubsections) {
      slugs.add(section.slug)
      subsections.forEach(sub => slugs.add(sub.slug))
    }
    return slugs
  }, [sectionsWithSubsections])

  const resultHref = (slug: string) =>
    currentBylawId != null && currentPageSlugs.has(slug)
      ? `#${slug}`
      : `${BASE_PATH}?section=${encodeURIComponent(slug)}`

  return (
    <ReferenceSidebarProvider>
      <div className="mx-auto w-full max-w-[1600px] p-3 space-y-4">
        <header className="fixed left-0 right-0 top-0 z-30 border-b border-gray-200 bg-white lg:sticky lg:top-0 lg:left-auto lg:right-auto lg:mb-6 lg:-mt-3">
          <div className="mx-auto w-full max-w-[1600px] px-3 pt-3 pb-2 lg:pb-3">
            <div className="bylaws-top-nav">
              <div className="bylaws-top-nav-spacer" />
              <div className="bylaws-top-nav-links">
                <p>
                  <a href="https://civiczone.ca/" className="bylaws-top-nav-link">
                    Home
                  </a>
                </p>
                <p>
                  <a
                    href="https://airdrie.civiczone.ca/bylaws/browse  "
                    className="bylaws-top-nav-link"
                  >
                    Aidrie Demo
                  </a>
                </p>
                <p>
                  <a href="https://civiczone.ca/contact/" className="bylaws-top-nav-link">
                    Contact Us
                  </a>
                </p>
              </div>
            </div>
            {/* Mobile: search first */}
            <div className="lg:hidden mb-3">
              <details className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-gray-800">
                  <span>Search the bylaws</span>
                  <span className="text-xs text-gray-600">tap to open</span>
                </summary>
                <div className="mt-3">
                  <SearchForm
                    searchQuery={searchQuery}
                    onQueryChange={setSearchQuery}
                    onSubmit={handleSearch}
                    isSearching={isSearching}
                  />
                </div>
              </details>
            </div>

            {/* Row: title + hamburger (mobile) / title + search (desktop) */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 lg:gap-4">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold mb-0">
                    {isPicker ? 'Browse bylaw' : 'Bylaw'}
                  </h1>
                  {/* <p className="text-sm text-gray-600">
                  {isPicker
                    ? 'Select a bylaw to view its sections and subsections.'
                    : 'Browse sections and subsections for the selected bylaw.'}
                </p> */}
                </div>
                {bylawList.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTocOpen(true)}
                    aria-label="Open table of contents"
                    className="lg:hidden shrink-0 p-2 -mr-2 rounded-lg text-gray-700 hover:bg-gray-100"
                  >
                    <Menu className="h-6 w-6" />
                  </button>
                )}
              </div>

              <div className="hidden lg:block lg:w-full lg:max-w-2xl">
                <SearchForm
                  searchQuery={searchQuery}
                  onQueryChange={setSearchQuery}
                  onSubmit={handleSearch}
                  isSearching={isSearching}
                />
              </div>
            </div>

            {error && (
              <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                {error}
              </div>
            )}

            {hasSearched && !isSearching && searchResults.length === 0 && (
              <div className="mt-6 bg-gray-50 p-4 rounded-lg border border-gray-200 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-2 text-gray-600 italic">
                  <Search className="h-4 w-4" />
                  <p className="text-sm">
                    {`No matching bylaws found for "${lastEmptyQuery}". Try a different question.`}
                  </p>
                  <button
                    onClick={() => setHasSearched(false)}
                    className="ml-auto text-xs text-blue-600 hover:underline not-italic"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>
        {/* Spacer so content is not hidden under fixed header on mobile */}
        <div className="lg:hidden h-[11.5rem] shrink-0 mb-0" aria-hidden="true" />

        {/* Mobile TOC drawer */}
        {bylawList.length > 0 && (
          <>
            {tocOpen && (
              <div
                className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                aria-hidden="true"
                onClick={() => setTocOpen(false)}
              />
            )}
            <div
              className={`fixed left-0 right-0 top-0 z-50 max-h-[85vh] flex flex-col bg-white shadow-xl lg:hidden transition-transform duration-200 ${
                tocOpen ? 'translate-y-0' : '-translate-y-[100vh]'
              }`}
              aria-label="Table of contents"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-gray-200 p-3">
                <span className="font-semibold text-gray-800">Table of contents</span>
                <button
                  type="button"
                  onClick={() => setTocOpen(false)}
                  aria-label="Close table of contents"
                  className="p-2 -mr-2 rounded-lg text-gray-600 hover:bg-gray-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div
                className="min-h-0 overflow-y-auto p-3"
                onClick={() => setTocOpen(false)}
                role="presentation"
              >
                <BylawsBrowseSidebar
                  items={[]}
                  initialSectionSlug={initialSectionSlug}
                  currentBylawId={currentBylawId}
                  bylawList={bylawList}
                  sectionsByBylawId={{
                    ...sectionsByBylawId,
                    ...(currentBylawId != null ? { [currentBylawId]: sidebarItems } : {}),
                  }}
                />
              </div>
            </div>
          </>
        )}

        {searchResults.length > 0 && (
          <div
            style={{
              left: `${position.x}px`,
              top: `${position.y}px`,
              cursor: isDragging ? 'grabbing' : 'auto',
            }}
            onMouseDown={handleMouseDown}
            className="fixed z-50 w-[90vw] md:w-[520px] bg-blue-50/95 backdrop-blur-md rounded-2xl border-2 border-blue-200 shadow-2xl overflow-hidden select-none touch-none"
          >
            <div className="drag-handle bg-blue-600 p-2 cursor-grab active:cursor-grabbing flex items-center justify-between">
              <div className="flex items-center gap-2 text-white">
                <div className="grid grid-cols-2 gap-0.5 opacity-50">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="w-1 h-1 bg-white rounded-full" />
                  ))}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  Search results
                </span>
              </div>
              <button
                onClick={() => {
                  setSearchResults([])
                  setAiAnswer(null)
                  setHasSearched(false)
                  try {
                    sessionStorage.removeItem(AI_SEARCH_STORAGE_KEY)
                  } catch {
                    // ignore
                  }
                }}
                className="text-white hover:bg-white/20 p-1 rounded-md transition-colors"
              >
                <span className="text-xs font-bold">✕</span>
              </button>
            </div>

            <div className="p-4">
              <div className="space-y-3 max-h-[400px] md:max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-blue-200">
                {aiAnswer && (
                  <div className="bg-blue-600 text-white p-4 rounded-xl shadow-inner mb-4 text-[13px] leading-relaxed">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="bg-white/20 p-1 rounded">
                        <svg
                          className="w-3 h-3 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                          />
                        </svg>
                      </div>
                      <span className="font-bold uppercase tracking-tighter text-[10px]">
                        AI Summary
                      </span>
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap">
                      {aiAnswer}
                    </div>
                  </div>
                )}

                {searchResults.map(result => (
                  <div
                    key={result.id}
                    className="bg-white p-3 rounded-xl border border-blue-100 shadow-sm hover:border-blue-300 transition-all hover:shadow-md"
                  >
                    <Link
                      href={resultHref(result.slug)}
                      className="text-blue-600 font-bold hover:underline block text-[13px] leading-tight"
                    >
                      {result.code} {result.title}
                    </Link>
                    <p className="text-[12px] text-gray-600 mt-1.5 line-clamp-2 leading-snug">
                      {result.content.split('\n').slice(1).join(' ')}
                    </p>
                    <div className="mt-2 flex items-center justify-between border-t pt-2 border-blue-50">
                      <div className="text-[9px] font-black text-blue-400 uppercase tracking-tighter">
                        {Math.round(result.similarity * 100)}% Match
                      </div>
                      <Link
                        href={resultHref(result.slug)}
                        className="text-[10px] text-blue-600 font-bold hover:text-blue-800"
                      >
                        Navigate →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {isPicker ? (
          <div className="flex flex-col lg:flex-row gap-8">
            <aside
              className="hidden lg:block lg:w-[18rem] lg:shrink-0 lg:border-r lg:pr-4 lg:sticky lg:top-52 self-start"
              aria-label="Bylaw Navigation"
            >
              <BylawsBrowseSidebar
                items={[]}
                bylawList={bylawList}
                sectionsByBylawId={sectionsByBylawId}
              />
            </aside>
            <div className="flex-1 space-y-6">
              <h2 className="text-lg font-semibold text-gray-800 !mt-0">Select a bylaw</h2>
              <ul className="list-none space-y-2">
                {bylawList.map(b => (
                  <li key={b.id}>
                    <Link
                      href={`${BASE_PATH}?bylaw=${b.id}`}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      {b.title ?? `Bylaw ${b.id}`}
                    </Link>
                  </li>
                ))}
              </ul>
              {bylawList.length === 0 && (
                <p className="text-gray-600 text-sm">No bylaws available.</p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col lg:flex-row gap-8">
              <aside
                className="hidden lg:block lg:w-[18rem] lg:shrink-0 lg:border-r lg:pr-4 lg:sticky lg:top-52 self-start"
                aria-label="Bylaw Navigation"
              >
                <BylawsBrowseSidebar
                  items={[]}
                  initialSectionSlug={initialSectionSlug}
                  currentBylawId={currentBylawId}
                  bylawList={bylawList}
                  sectionsByBylawId={{
                    ...sectionsByBylawId,
                    ...(currentBylawId != null ? { [currentBylawId]: sidebarItems } : {}),
                  }}
                />
              </aside>

              <section className="flex-1 min-w-0 space-y-12">
                {sectionsWithSubsections.map(({ section, subsections }, index) => (
                  <section
                    key={section.id}
                    id={section.slug}
                    className="scroll-mt-[13rem] lg:scroll-mt-[10rem] space-y-6"
                  >
                    <div>
                      {index === 0 && section.bylaw?.title && (
                        <p className="text-2xl font-semibold text-gray-700 mb-2">
                          {section.bylaw.title}
                        </p>
                      )}
                      <h2 className="text-lg font-semibold">
                        {section.code} {section.title}
                      </h2>
                    </div>

                    {section.content && section.content.length > 0 && (
                      <div className="section-content">
                        <BlocksRenderer blocks={section.content} />
                      </div>
                    )}

                    <div className="space-y-8">
                      {subsections.map(sub => (
                        <SubsectionArticle key={sub.id} sub={sub} />
                      ))}
                    </div>
                  </section>
                ))}
              </section>

              <ReferenceSidebar />
            </div>
          </>
        )}

        <ReferenceDrawer />
      </div>
    </ReferenceSidebarProvider>
  )
}
