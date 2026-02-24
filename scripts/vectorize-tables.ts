/**
 * Vectorize bylaw subsection table blocks into bylaw_embeddings using OpenAI.
 * Data source: PostgreSQL via Payload API (not SQLite).
 * Targets "2. Administrative Requirements" and "3. Landscaping Requirements" and their subsections.
 *
 * Run: tsx scripts/vectorize-tables.ts
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

function extractTextFromLexicalNode(node: { text?: string; children?: unknown[] }): string {
  if (node.text && typeof node.text === 'string') return node.text
  if (Array.isArray(node.children)) {
    return node.children.map((child: unknown) => extractTextFromLexicalNode(child as { text?: string; children?: unknown[] })).join('')
  }
  return ''
}

function extractTextFromLexicalBody(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const root = (body as { root?: { children?: unknown[] } }).root
  if (!root || !Array.isArray(root.children)) return ''
  return root.children.map((child: unknown) => extractTextFromLexicalNode(child as { text?: string; children?: unknown[] })).join('\n')
}

type TableBlock = {
  blockType?: string
  title?: string | null
  rows?: { cells?: { text?: string | null; body?: unknown }[] }[]
}

type ContentBlock = TableBlock & {
  body?: unknown
  items?: { text?: string }[]
}

async function run() {
  await pgClient.connect()
  console.log('Connected to vector DB (PostgreSQL)')

  const payload = await getPayload({ config })
  console.log('Payload connected (data source: PostgreSQL)')

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

  const sectionsResult = await payload.find({
    collection: 'bylawSections',
    where: { bylaw: { in: bylawIds } },
    limit: 500,
    depth: 0,
    pagination: false,
  })
  const sectionIds = (sectionsResult.docs as { id: number }[]).map(s => s.id)

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
  console.log(`Found ${subsections.length} subsections (PostgreSQL)`)

  await pgClient.query('CREATE EXTENSION IF NOT EXISTS vector;')
  await pgClient.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;')
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS bylaw_embeddings (
      id SERIAL PRIMARY KEY,
      title TEXT,
      code TEXT,
      slug TEXT,
      content TEXT,
      embedding vector(1536)
    );
  `)

  const tableSlugs: string[] = []
  const tableRows: { slug: string; title: string; code: string; content: string }[] = []

  for (const sub of subsections) {
    const blocks = sub.content || []
    let tableIndex = 0
    for (const block of blocks) {
      if (block.blockType !== 'table') continue
      const title = block.title || 'Untitled'
      let tableContent = `Table: ${title}\n`
      tableContent += `Bylaw Section: ${sub.code} ${sub.title || sub.label || ''}\n\n`
      for (const row of block.rows || []) {
        const cellTexts = (row.cells || []).map(c => {
          if (c.text && String(c.text).trim()) return String(c.text)
          if (c.body) return extractTextFromLexicalBody(c.body)
          return ''
        })
        tableContent += cellTexts.join(' | ') + '\n'
      }
      if (tableContent.trim().length < 10) continue
      const slug = `${sub.slug}#table-${tableIndex}`
      tableSlugs.push(slug)
      tableRows.push({
        slug,
        title: `Table: ${title} (${sub.title || sub.label || sub.code})`,
        code: sub.code,
        content: tableContent,
      })
      tableIndex++
    }
  }

  console.log(`Found ${tableRows.length} tables to vectorize`)

  if (tableSlugs.length > 0) {
    await pgClient.query(`DELETE FROM bylaw_embeddings WHERE slug = ANY($1::text[])`, [tableSlugs])
    console.log('Cleared existing table embeddings for target bylaws')
  }

  for (const row of tableRows) {
    try {
      const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: row.content,
      })
      const [first] = res.data
      if (!first?.embedding) continue
      await pgClient.query(
        `INSERT INTO bylaw_embeddings (title, code, slug, content, embedding) VALUES ($1, $2, $3, $4, $5::vector)`,
        [row.title, row.code, row.slug, row.content, JSON.stringify(first.embedding)],
      )
      console.log(`  table ${row.slug}`)
    } catch (e) {
      console.error(`Error table ${row.slug}:`, e)
    }
  }

  console.log('Finished table vectorization')
  await pgClient.end()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
