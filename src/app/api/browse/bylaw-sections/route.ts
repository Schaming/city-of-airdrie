import { NextRequest, NextResponse } from 'next/server'
import configPromise from '@payload-config'
import { getPayload } from 'payload'

const SECTION_LIMIT = 500

type SubsectionDoc = {
  id: string | number
  slug: string
  code: string
  title: string | null
  level?: number
  sortOrder?: number
}

type SectionDoc = {
  id: string | number
  slug: string
  code: string
  title: string | null
  bylaw?: number | { id: number; title: string | null }
}

function getBylawId(ref: number | { id: number } | null | undefined): number | null {
  if (ref == null) return null
  return typeof ref === 'number' ? ref : ref.id
}

function sortSubsections(subsections: SubsectionDoc[]) {
  return [...subsections].sort((a, b) => {
    const aOrder = a.sortOrder ?? Number.NEGATIVE_INFINITY
    const bOrder = b.sortOrder ?? Number.NEGATIVE_INFINITY
    if (aOrder !== bOrder) return aOrder - bOrder
    return (b.code || '').localeCompare(a.code || '', undefined, { numeric: true })
  })
}

export type BylawSectionSidebarItem = {
  id: string | number
  slug: string
  code: string
  title: string
  bylaw?: { id: number; title: string | null } | null
  subsections: { id: string | number; slug: string; code: string; title: string; level?: number }[]
}

export async function GET(req: NextRequest) {
  const bylawIdParam = req.nextUrl.searchParams.get('bylaw')
  if (!bylawIdParam) {
    return NextResponse.json({ error: 'Missing bylaw id' }, { status: 400 })
  }
  const bylawId = parseInt(bylawIdParam, 10)
  if (Number.isNaN(bylawId)) {
    return NextResponse.json({ error: 'Invalid bylaw id' }, { status: 400 })
  }

  try {
    const payload = await getPayload({ config: configPromise })

    const result = await payload.find({
      collection: 'bylawSections',
      where: { bylaw: { equals: bylawId } },
      limit: SECTION_LIMIT,
      depth: 1,
      select: { id: true, slug: true, code: true, title: true, bylaw: true },
    })

    const sections = (result.docs as SectionDoc[]) ?? []
    const sorted = sections.sort((a, b) =>
      (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }),
    )

    const sectionData: BylawSectionSidebarItem[] = await Promise.all(
      sorted.map(async section => {
        const subResult = await payload.find({
          collection: 'bylawSubsections',
          where: { section: { equals: section.id } },
          sort: '-sortOrder',
          limit: 500,
          depth: 0,
          select: { id: true, slug: true, code: true, title: true, level: true },
        })
        const subs = sortSubsections((subResult.docs as unknown as SubsectionDoc[]) ?? [])
        return {
          id: section.id,
          slug: section.slug,
          code: section.code,
          title: section.title ?? '',
          bylaw:
            section.bylaw != null
              ? {
                  id: getBylawId(section.bylaw)!,
                  title: typeof section.bylaw === 'object' ? section.bylaw.title : null,
                }
              : null,
          subsections: subs.map(s => ({
            id: s.id,
            slug: s.slug,
            code: s.code,
            title: s.title ?? '',
            level: s.level,
          })),
        }
      }),
    )

    return NextResponse.json({ sections: sectionData })
  } catch (error) {
    console.error('Failed to fetch bylaw sections', error)
    return NextResponse.json({ error: 'Failed to fetch sections' }, { status: 500 })
  }
}
