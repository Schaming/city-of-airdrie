/**
 * Vectorize bylaws "2. Administrative Requirements" and "3. Landscaping Requirements"
 * and their sections and subsections into bylaw_embeddings using OpenAI.
 *
 * Uses Payload API for data; writes to VECTOR_DATABASE_URL.
 * Run: pnpm run vectorize:bylaws (or tsx scripts/vectorize-bylaws-airdrie.ts)
 */
import './load-env'
import pg from 'pg'
import OpenAI from 'openai'
import config from '@payload-config'
import { getPayload } from 'payload'

const VECTOR_DATABASE_URL = process.env.VECTOR_DATABASE_URL
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

const TARGET_BYLAW_TITLES = [
  '2. Administrative Requirements',
  '3. Landscaping Requirements',
] as const

if (!VECTOR_DATABASE_URL || !OPENAI_API_KEY) {
  console.error('Missing VECTOR_DATABASE_URL or OPENAI_API_KEY in environment.')
  process.exit(1)
}

const pgClient = new pg.Client({ connectionString: VECTOR_DATABASE_URL })
const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

// --- Lexical / block text extraction (works on Payload block JSON) ---

function extractTextFromLexicalNode(node: { text?: string; children?: unknown[] }): string {
  if (node.text && typeof node.text === 'string') return node.text
  if (Array.isArray(node.children)) {
    return node.children.map((child: unknown) => extractTextFromLexicalNode(child as any)).join('')
  }
  return ''
}

function extractTextFromLexicalBody(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const root = (body as { root?: { children?: unknown[] } }).root
  if (!root || !Array.isArray(root.children)) return ''
  return root.children.map((child: unknown) => extractTextFromLexicalNode(child as any)).join('\n')
}

type ContentBlock = {
  blockType?: string
  body?: unknown
  title?: string | null
  rows?: { cells?: { text?: string | null; body?: unknown }[] }[]
  items?: { text?: string }[]
}

function blocksToText(blocks: ContentBlock[] | null | undefined): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks) {
    const t = block.blockType
    if (t === 'richText' && block.body) {
      parts.push(extractTextFromLexicalBody(block.body))
    } else if (t === 'table') {
      const title = block.title || 'Untitled'
      parts.push(`Table: ${title}`)
      for (const row of block.rows || []) {
        const cellTexts = (row.cells || []).map(c => {
          if (c.text && String(c.text).trim()) return String(c.text)
          if (c.body) return extractTextFromLexicalBody(c.body)
          return ''
        })
        parts.push(cellTexts.join(' | '))
      }
    } else if (t === 'list' && block.items) {
      for (const item of block.items) {
        if (item.text) parts.push(item.text)
      }
    }
  }
  return parts.filter(Boolean).join('\n')
}

// --- Ensure vector table exists (matches semanticSearch.ts: id, title, code, slug, content, embedding) ---

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS bylaw_embeddings (
    id SERIAL PRIMARY KEY,
    title TEXT,
    code TEXT,
    slug TEXT,
    content TEXT,
    embedding vector(1536)
  );
`

async function ensureTable() {
  await pgClient.query('CREATE EXTENSION IF NOT EXISTS vector;')
  await pgClient.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;')
  await pgClient.query(CREATE_TABLE_SQL)
}

async function run() {
  await pgClient.connect()
  console.log('Connected to vector DB')
  await ensureTable()

  const payload = await getPayload({ config })
  console.log('Payload connected')

  // 1) Resolve target bylaws by title
  const bylawsResult = await payload.find({
    collection: 'bylaws',
    where: { title: { in: [...TARGET_BYLAW_TITLES] } },
    limit: 10,
    select: { id: true, title: true },
  })
  const bylaws = bylawsResult.docs as { id: number; title: string | null }[]
  if (bylaws.length === 0) {
    console.error('No bylaws found with titles:', TARGET_BYLAW_TITLES)
    await pgClient.end()
    process.exit(1)
  }
  const bylawIds = bylaws.map(b => b.id)
  console.log('Target bylaws:', bylaws.map(b => `${b.id}: ${b.title}`).join(', '))

  // 2) Fetch all sections for these bylaws (with content)
  const sectionsResult = await payload.find({
    collection: 'bylawSections',
    where: { bylaw: { in: bylawIds } },
    limit: 500,
    depth: 0,
    pagination: false,
    select: { id: true, code: true, title: true, label: true, slug: true, content: true },
  })
  const sections = sectionsResult.docs as {
    id: number
    code: string
    title: string | null
    label: string
    slug: string
    content?: ContentBlock[] | null
  }[]
  const sectionIds = sections.map(s => s.id)
  console.log(`Found ${sections.length} sections`)

  // 3) Fetch all subsections for these sections (with content)
  const subsectionsResult = await payload.find({
    collection: 'bylawSubsections',
    where: { section: { in: sectionIds } },
    limit: 5000,
    depth: 0,
    pagination: false,
    sort: 'sortOrder',
    select: { id: true, code: true, title: true, label: true, slug: true, content: true },
  })
  const subsections = subsectionsResult.docs as {
    id: number
    code: string
    title: string | null
    label: string
    slug: string
    content?: ContentBlock[] | null
  }[]
  console.log(`Found ${subsections.length} subsections`)

  // 4) Delete existing embeddings for these sections/subsections (by slug) so we can replace
  const allSlugs = [...sections.map(s => s.slug), ...subsections.map(s => s.slug)]
  if (allSlugs.length > 0) {
    await pgClient.query(
      `DELETE FROM bylaw_embeddings WHERE slug = ANY($1::text[])`,
      [allSlugs],
    )
    console.log('Cleared existing embeddings for target sections/subsections')
  }

  const insertRow = async (row: {
    title: string
    code: string
    slug: string
    content: string
  }) => {
    if (row.content.trim().length < 5) return
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: row.content,
    })
    const [first] = res.data
    if (!first?.embedding) return
    await pgClient.query(
      `INSERT INTO bylaw_embeddings (title, code, slug, content, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)`,
      [
        row.title,
        row.code,
        row.slug,
        row.content,
        JSON.stringify(first.embedding),
      ],
    )
  }

  // 5) Vectorize sections
  for (const section of sections) {
    const text = blocksToText(section.content)
    const content = `${section.code} ${section.title || section.label || ''}\n\n${text}`.trim()
    if (content.length < 5) continue
    try {
      await insertRow({
        title: section.title || section.label || section.code,
        code: section.code,
        slug: section.slug,
        content,
      })
      console.log(`  section ${section.code}`)
    } catch (e) {
      console.error(`Error section ${section.code}:`, e)
    }
  }

  // 6) Vectorize subsections
  for (const sub of subsections) {
    const text = blocksToText(sub.content)
    const content = `${sub.code} ${sub.title || sub.label || ''}\n\n${text}`.trim()
    if (content.length < 5) continue
    try {
      await insertRow({
        title: sub.title || sub.label || sub.code,
        code: sub.code,
        slug: sub.slug,
        content,
      })
      console.log(`  subsection ${sub.code}`)
    } catch (e) {
      console.error(`Error subsection ${sub.code}:`, e)
    }
  }

  console.log('Vectorization finished.')
  await pgClient.end()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
