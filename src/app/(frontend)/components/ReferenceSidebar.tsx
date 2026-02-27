'use client';

import React from 'react';
import { useReferenceSidebar } from './ReferenceSidebarContext';
import { InteractiveLexicalRenderer } from './InteractiveLexicalRenderer';

export function ReferenceSidebar() {
  const { data, loading, error } = useReferenceSidebar();

  return (
    <aside 
      className="hidden md:block md:w-72 md:shrink-0 md:border-l md:pl-4 md:sticky md:top-52 md:bottom-0 self-start md:max-h-[calc(100vh-13rem)] md:max-h-[calc(100dvh-13rem)] md:overflow-y-auto"
      aria-label="Reference Details"
    >
      <div className="space-y-4 pr-2">
        <div className="font-semibold text-sm uppercase text-gray-600 tracking-wider">
          Reference
        </div>

        {!data && (
          <p className="text-sm text-gray-600 italic">
            Click a definition or amendment link to see details.
          </p>
        )}

        {data?.type === 'definition' && (
          <div className="space-y-3 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-blue-600 uppercase tracking-wide">
                Definition
              </span>
            </div>
            <div className="highlight-def inline-block px-2 py-1 rounded text-sm uppercase tracking-wide">
              {data.term}
            </div>
            {loading && <p className="text-sm text-gray-600 animate-pulse">Loading...</p>}
            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
            {!loading && !error && data.content && (
              <div className="prose prose-sm text-gray-800 border-t pt-3">
                <InteractiveLexicalRenderer data={data.content} />
              </div>
            )}
            {!loading && !error && !data.content && (
              <p className="text-sm text-gray-600 italic">No definition found.</p>
            )}
          </div>
        )}

        {data?.type === 'amendment' && (
          <div className="space-y-3 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-amber-600 uppercase tracking-wide">
                Amendment
              </span>
            </div>
            <div className="bg-amber-100 inline-block px-2 py-1 rounded text-sm font-medium">
              {data.amendment.title}
            </div>
            <div className="text-xs text-gray-600">
              Year: {data.amendment.year}
            </div>
            <div className="prose prose-sm text-gray-800 border-t pt-3">
              <InteractiveLexicalRenderer data={data.amendment.body} />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
