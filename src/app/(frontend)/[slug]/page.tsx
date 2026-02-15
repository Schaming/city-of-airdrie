import type { Metadata } from 'next'
import { cache } from 'react'
import { draftMode } from 'next/headers'
import { notFound } from 'next/navigation'

import { getPayload } from 'payload'
import configPromise from '@payload-config'

import type { Page as PageType } from '@/payload-types'

import { RenderBlocks } from '@/blocks/RenderBlocks'
import { RenderHero } from '@/heros/RenderHero'
import { LivePreviewListener } from '@/components/LivePreviewListener'
import { generateMeta } from '@/utilities/generateMeta'

// Dynamic so Cloud Build can complete without a DB (generateStaticParams not run at build)
export const dynamic = 'force-dynamic'

export async function generateStaticParams() {
  try {
    const payload = await getPayload({ config: configPromise })
    const pages = await payload.find({
      collection: 'pages',
      draft: false,
      limit: 1000,
      overrideAccess: false,
      pagination: false,
      select: {
        slug: true,
      },
    })

    return pages.docs
      .filter((doc) => doc.slug !== 'home')
      .map(({ slug }) => ({ slug }))
  } catch (error) {
    return []
  }
}

type Args = {
  params: Promise<{
    slug?: string
  }>
}

export default async function Page({ params: paramsPromise }: Args) {
  const { slug = 'home' } = await paramsPromise
  const page = await queryPageBySlug({ slug })

  if (!page) {
    return notFound()
  }

  const { isEnabled: draft } = await draftMode()

  return (
    <article className="pb-24">
      {draft && <LivePreviewListener />}
      
      {page.hero && <RenderHero {...page.hero} />}
      {page.layout && <RenderBlocks blocks={page.layout} />}
    </article>
  )
}

export async function generateMetadata({ params: paramsPromise }: Args): Promise<Metadata> {
  const { slug = 'home' } = await paramsPromise
  const page = await queryPageBySlug({ slug })

  return generateMeta({ doc: page })
}

const queryPageBySlug = cache(async ({ slug }: { slug: string }) => {
  const { isEnabled: draft } = await draftMode()

  try {
    const payload = await getPayload({ config: configPromise })

    const result = await payload.find({
      collection: 'pages',
      draft,
      limit: 1,
      overrideAccess: draft,
      pagination: false,
      where: {
        slug: {
          equals: slug,
        },
      },
    })

    return result.docs?.[0] || null
  } catch (error) {
    return null
  }
})
