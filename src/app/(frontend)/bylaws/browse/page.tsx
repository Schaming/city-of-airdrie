import '../bylaws.css'
import { BylawsBrowseView, type SidebarSectionItem } from './BylawsBrowseView'
import type {
  BylawSection,
  BylawSubsection,
  SectionWithSubsections,
} from '../../components/AllBylawsView'
import { siteConfig } from '@/config/site'
import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'

const SECTION_LIMIT = 500
const BASE_PATH = '/bylaws/browse'

export const dynamic = 'force-dynamic'

function getBylawId(ref: number | { id: number } | null | undefined): number | null {
  if (ref == null) return null
  return typeof ref === 'number' ? ref : ref.id
}

function sortSubsections(subsections: BylawSubsection[]) {
  return [...subsections].sort((a, b) => {
    const aOrder = a.sortOrder ?? Number.NEGATIVE_INFINITY
    const bOrder = b.sortOrder ?? Number.NEGATIVE_INFINITY
    if (aOrder !== bOrder) return aOrder - bOrder
    return (b.code || '').localeCompare(a.code || '', undefined, { numeric: true })
  })
}

const SUBSECTION_LIMIT = 5000

async function getSectionsByBylawId(bylawId: number): Promise<SectionWithSubsections[]> {
  try {
    const payload = await getPayload({ config: configPromise })
    const result = await payload.find({
      collection: 'bylawSections',
      where: { bylaw: { equals: bylawId } },
      limit: SECTION_LIMIT,
      depth: 1,
      pagination: false,
      select: {
        id: true,
        slug: true,
        label: true,
        code: true,
        title: true,
        bylaw: true,
        content: true,
      },
    })
    const sections = (result.docs as unknown as BylawSection[]) ?? []
    const sorted = sections.sort((a, b) =>
      (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }),
    )
    if (sorted.length === 0) return []

    const sectionIds = sorted.map(s => s.id)
    const subResult = await payload.find({
      collection: 'bylawSubsections',
      where: { section: { in: sectionIds } },
      sort: '-sortOrder',
      limit: SUBSECTION_LIMIT,
      depth: 0,
      pagination: false,
      select: {
        id: true,
        slug: true,
        label: true,
        code: true,
        title: true,
        level: true,
        sortOrder: true,
        section: true,
        content: true,
        amendments: true,
      },
    })
    const allSubs = (subResult.docs as unknown as BylawSubsection[]) ?? []
    const getSectionId = (
      ref: number | { id: number } | null | undefined,
    ): string | number | null => {
      if (ref == null) return null
      return typeof ref === 'number' ? ref : ref.id
    }
    const subsBySectionId = new Map<string | number, BylawSubsection[]>()
    for (const sub of allSubs) {
      const sid = getSectionId((sub as { section?: number | { id: number } }).section)
      if (sid != null) {
        const list = subsBySectionId.get(sid) ?? []
        list.push(sub)
        subsBySectionId.set(sid, list)
      }
    }
    return sorted.map(section => ({
      section,
      subsections: sortSubsections(subsBySectionId.get(section.id) ?? []),
    }))
  } catch (error) {
    console.error('Failed to fetch sections by bylaw', error)
    return []
  }
}

/** Cached per bylaw; revalidate every 2 minutes so repeat loads are fast. */
function getCachedSectionsByBylawId(bylawId: number): Promise<SectionWithSubsections[]> {
  return unstable_cache(() => getSectionsByBylawId(bylawId), ['bylaw-sections', String(bylawId)], {
    revalidate: 120,
  })()
}

async function resolveBylawIdFromSlug(slug: string): Promise<number | null> {
  try {
    const payload = await getPayload({ config: configPromise })
    const sectionResult = await payload.find({
      collection: 'bylawSections',
      where: { slug: { equals: slug } },
      limit: 1,
      depth: 1,
      select: { id: true, bylaw: true },
    })
    if (sectionResult.docs.length > 0) {
      const doc = sectionResult.docs[0] as { bylaw?: number | { id: number } }
      return getBylawId(doc.bylaw as number | { id: number }) ?? null
    }
    const subResult = await payload.find({
      collection: 'bylawSubsections',
      where: { slug: { equals: slug } },
      limit: 1,
      depth: 2,
      select: { id: true, section: true },
    })
    if (subResult.docs.length > 0) {
      const doc = subResult.docs[0] as {
        section?: number | { id: string | number; bylaw?: number | { id: number } }
      }
      const section = doc.section
      if (section && typeof section === 'object' && section.bylaw != null) {
        return getBylawId(section.bylaw as number | { id: number }) ?? null
      }
      if (section && typeof section === 'object' && section.id != null) {
        const sectionDoc = await payload.findByID({
          collection: 'bylawSections',
          id: section.id,
          depth: 1,
          select: { bylaw: true },
        })
        const s = sectionDoc as { bylaw?: number | { id: number } }
        return getBylawId(s.bylaw as number | { id: number }) ?? null
      }
    }
    return null
  } catch (error) {
    console.error('Failed to resolve bylaw from slug', error)
    return null
  }
}

export type BylawListItem = { id: number; title: string | null }

async function fetchBylawList(): Promise<BylawListItem[]> {
  try {
    const payload = await getPayload({ config: configPromise })
    const result = await payload.find({
      collection: 'bylaws',
      limit: 50,
      select: { id: true, title: true },
    })
    return (result.docs as BylawListItem[]) ?? []
  } catch (error) {
    console.error('Failed to fetch bylaw list', error)
    return []
  }
}

async function bylawIdExists(bylawId: number): Promise<boolean> {
  try {
    const payload = await getPayload({ config: configPromise })
    await payload.findByID({ collection: 'bylaws', id: bylawId })
    return true
  } catch {
    return false
  }
}

type PageProps = { searchParams: Promise<{ bylaw?: string; section?: string }> }

export default async function BylawsBrowsePage({ searchParams }: PageProps) {
  const params = await searchParams
  const bylawParam = params.bylaw
  const sectionParam = params.section

  if (sectionParam && !bylawParam) {
    const resolvedId = await resolveBylawIdFromSlug(sectionParam)
    if (resolvedId != null) {
      redirect(`${BASE_PATH}?bylaw=${resolvedId}&section=${encodeURIComponent(sectionParam)}`)
    }
  }

  const bylawList = await fetchBylawList()

  // Preload sections for all bylaws when in picker mode (no bylaw selected)
  let sectionsByBylawId: Record<number, SidebarSectionItem[]> = {}
  if (!bylawParam && bylawList.length > 0) {
    const entries = await Promise.all(
      bylawList.map(async b => {
        const data = await getCachedSectionsByBylawId(b.id)
        const sections: SidebarSectionItem[] = data.map(({ section, subsections }) => ({
          id: section.id,
          slug: section.slug,
          code: section.code,
          title: section.title ?? '',
          bylaw: section.bylaw ?? null,
          subsections: subsections.map(s => ({
            id: s.id,
            slug: s.slug,
            code: s.code,
            title: s.title ?? '',
            level: s.level,
          })),
        }))
        return [b.id, sections] as const
      }),
    )
    sectionsByBylawId = Object.fromEntries(entries)
  }

  if (bylawParam) {
    const bylawId = parseInt(bylawParam, 10)
    if (Number.isNaN(bylawId) || !(await bylawIdExists(bylawId))) {
      return (
        <>
          <BylawsBrowseView bylawList={bylawList} error="Invalid or unknown bylaw." />
          <footer className="bylaws-footer">
            <p>{siteConfig.bylaws.footerDisclaimer}</p>
          </footer>
        </>
      )
    }
    const sectionsWithSubsections = await getCachedSectionsByBylawId(bylawId)
    return (
      <>
        <BylawsBrowseView
          bylawList={bylawList}
          sectionsWithSubsections={sectionsWithSubsections}
          initialSectionSlug={sectionParam ?? null}
          currentBylawId={bylawId}
        />
        <footer className="bylaws-footer">
          <p>{siteConfig.bylaws.footerDisclaimer}</p>
        </footer>
      </>
    )
  }

  return (
    <>
      <BylawsBrowseView bylawList={bylawList} sectionsByBylawId={sectionsByBylawId} />
      <footer className="bylaws-footer">
        <p>{siteConfig.bylaws.footerDisclaimer}</p>
      </footer>
    </>
  )
}
