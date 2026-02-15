import Link from 'next/link'
import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { type BylawSection } from '../components/AllBylawsView'

export const dynamic = 'force-dynamic'

async function getSections(): Promise<BylawSection[]> {
  try {
    const payload = await getPayload({ config: configPromise })
    const result = await payload.find({
      collection: 'bylawSections',
      limit: 200,
      select: {
        id: true,
        slug: true,
        label: true,
        code: true,
        title: true,
      },
    })
    return (result.docs as unknown as BylawSection[]) ?? []
  } catch (error) {
    console.error('Failed to fetch sections during build', error)
    return []
  }
}

export default async function BylawsIndexPage() {
  const sections = await getSections()

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="text-2xl font-semibold mb-4">Bylaw Sections</h1>
      <p className="text-sm text-gray-600 mb-3">
        Browse a single bylaw below or{' '}
        <Link href="/bylaws/all" className="text-blue-600 hover:underline">
          view all bylaws together
        </Link>
        .
      </p>
      <ul className="space-y-2">
        {sections.map(s => (
          <li key={s.id}>
            <Link href={`/bylaws/${s.slug}`} className="text-blue-600 hover:underline">
              {s.code} {s.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
