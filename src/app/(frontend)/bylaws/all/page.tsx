import '../bylaws.css'
import {
  AllBylawsView,
  type BylawSection,
  type BylawSubsection,
  type SectionWithSubsections,
} from '../../components/AllBylawsView'
import { siteConfig } from '@/config/site'
import configPromise from '@payload-config'
import { getPayload } from 'payload'

const SECTION_LIMIT = 500

export const dynamic = 'force-dynamic'

function sortSubsections(subsections: BylawSubsection[]) {
  return [...subsections].sort((a, b) => {
    const aOrder = a.sortOrder ?? Number.NEGATIVE_INFINITY
    const bOrder = b.sortOrder ?? Number.NEGATIVE_INFINITY
    if (aOrder !== bOrder) return aOrder - bOrder // higher sortOrder first

    // Fallback to code (descending) to keep order predictable
    return (b.code || '').localeCompare(a.code || '', undefined, { numeric: true })
  })
}

async function fetchSections(): Promise<BylawSection[]> {
  try {
    const payload = await getPayload({ config: configPromise })
    const result = await payload.find({
      collection: 'bylawSections',
      limit: SECTION_LIMIT,
      depth: 1, // Populate bylaw so we can show which bylaw encompasses each section
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

    // Keep sections stable by code ascending
    return sections.sort((a, b) =>
      (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }),
    )
  } catch (error) {
    console.error('Failed to fetch sections during build', error)
    return []
  }
}

async function fetchSubsections(sectionId: string | number): Promise<BylawSubsection[]> {
  try {
    const payload = await getPayload({ config: configPromise })
    const result = await payload.find({
      collection: 'bylawSubsections',
      where: {
        section: {
          equals: sectionId,
        },
      },
      sort: '-sortOrder',
      limit: 500,
      depth: 2, // Populate amendments relationship
    })

    return sortSubsections((result.docs as unknown as BylawSubsection[]) ?? [])
  } catch (error) {
    console.error('Failed to fetch subsections during build', error)
    return []
  }
}

async function getAllSectionsWithSubsections(): Promise<SectionWithSubsections[]> {
  const sections = await fetchSections()

  const sectionData = await Promise.all(
    sections.map(async section => {
      const subsections = await fetchSubsections(section.id)
      return { section, subsections }
    }),
  )

  return sectionData
}

export default async function AllBylawsPage() {
  const sectionsWithSubsections = await getAllSectionsWithSubsections()

  return (
    <>
      <AllBylawsView sectionsWithSubsections={sectionsWithSubsections} />
      <footer className="bylaws-footer">
        <p>{siteConfig.bylaws.footerDisclaimer}</p>
      </footer>
    </>
  )
}
