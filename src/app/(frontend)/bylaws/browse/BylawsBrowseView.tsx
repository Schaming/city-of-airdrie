'use client'

import React, { useEffect, useState } from 'react'
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
import { Search, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { BylawsBrowseSidebar } from './BylawsBrowseSidebar'

const BASE_PATH = '/bylaws/browse'

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
    <article id={sub.slug} className={sub.level && sub.level > 1 ? 'ml-6 border-l pl-4' : ''}>
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
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

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
        setPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y,
        })
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
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
      setSearchResults(results.sort((a, b) => b.similarity - a.similarity))
      setAiAnswer(data.answer || null)
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

  return (
    <ReferenceSidebarProvider>
      <div className="max-w-7xl mx-auto p-3 space-y-4">
        <header className="border-b pb-4 mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{isPicker ? 'Browse bylaw' : 'Bylaw'}</h1>
              <p className="text-sm text-gray-600">
                {isPicker
                  ? 'Select a bylaw to view its sections and subsections.'
                  : 'Browse sections and subsections for the selected bylaw.'}
              </p>
            </div>

            <div className="hidden md:block md:w-full md:max-w-2xl">
              <SearchForm
                searchQuery={searchQuery}
                onQueryChange={setSearchQuery}
                onSubmit={handleSearch}
                isSearching={isSearching}
              />
            </div>
          </div>

          <div className="md:hidden mt-4">
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
        </header>

        {searchResults.length > 0 && (
          <div
            style={{
              left: `${position.x}px`,
              top: `${position.y}px`,
              cursor: isDragging ? 'grabbing' : 'auto',
            }}
            onMouseDown={handleMouseDown}
            className="fixed z-50 w-[90vw] md:w-[400px] bg-blue-50/95 backdrop-blur-md rounded-2xl border-2 border-blue-200 shadow-2xl overflow-hidden select-none touch-none"
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
                }}
                className="text-white hover:bg-white/20 p-1 rounded-md transition-colors"
              >
                <span className="text-xs font-bold">✕</span>
              </button>
            </div>

            <div className="p-4">
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-blue-200">
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
                      href={`${BASE_PATH}?section=${encodeURIComponent(result.slug)}`}
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
                        href={`${BASE_PATH}?section=${encodeURIComponent(result.slug)}`}
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
          <div className="flex flex-col md:flex-row gap-8">
            <aside
              className="hidden md:block md:w-72 md:shrink-0 md:border-r md:pr-4 md:sticky md:top-4 self-start"
              aria-label="Bylaw Navigation"
            >
              <BylawsBrowseSidebar
                items={[]}
                bylawList={bylawList}
                sectionsByBylawId={sectionsByBylawId}
              />
            </aside>
            <div className="flex-1 space-y-6">
              <h2 className="text-lg font-semibold text-gray-800">Select a bylaw</h2>
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
            <div className="md:hidden">
              <details className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-gray-800 hover:text-blue-700">
                  <span>Table of contents</span>
                  <span className="text-xs text-gray-600">tap to expand</span>
                </summary>
                <div className="mt-3">
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
              </details>
            </div>

            <div className="flex flex-col md:flex-row gap-8">
              <aside
                className="hidden md:block md:w-72 md:shrink-0 md:border-r md:pr-4 md:sticky md:top-4 self-start"
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
                  <section key={section.id} id={section.slug} className="space-y-6">
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
