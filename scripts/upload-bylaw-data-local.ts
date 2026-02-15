// scripts/upload-bylaw-data.ts
// Uploads extracted bylaw data to Payload CMS using Local API
import 'dotenv/config'
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import config from '@payload-config'
import { getPayload, Payload } from 'payload'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DATA_DIR = path.resolve(__dirname, '../extracted-bylaw-data')

interface BylawData {
  code?: string // Single digit code (1, 2, 3, etc.)
  title: string
  jurisdiction?: string
  effectiveDate?: string
  sortKey: string
}

interface BylawSectionData {
  code: string
  title?: string
  label: string
  slug: string
  sortKey: string
  content: any[]
  bylaw?: string | number
}

interface BylawSubsectionData {
  code: string
  level?: number
  title?: string
  label: string
  slug: string
  sortOrder?: number
  content: any[]
  section?: string | number
  parentSubsection?: string | number
}

/**
 * Remove fields that shouldn't be sent to Payload CMS
 */
function cleanDataForUpload<T extends Record<string, any>>(data: T): T {
  const cleaned = { ...data }
  // Remove 'id' field if present (Payload CMS generates IDs automatically)
  delete cleaned.id
  return cleaned
}

/**
 * Clean array of data objects
 */
function cleanArrayForUpload<T extends Record<string, any>>(items: T[]): T[] {
  return items.map(item => cleanDataForUpload(item))
}

/**
 * Load JSON data files from a given directory
 */
async function loadExtractedData(dataDir: string) {
  const bylawsPath = path.join(dataDir, 'bylaws.json')
  const sectionsPath = path.join(dataDir, 'bylaw-sections.json')
  const subsectionsPath = path.join(dataDir, 'bylaw-subsections.json')

  const [bylawsData, sectionsData, subsectionsData] = await Promise.all([
    fs.readFile(bylawsPath, 'utf-8').then(JSON.parse),
    fs.readFile(sectionsPath, 'utf-8').then(JSON.parse),
    fs.readFile(subsectionsPath, 'utf-8').then(JSON.parse),
  ])

  return {
    bylaws: cleanArrayForUpload(bylawsData as BylawData[]),
    sections: cleanArrayForUpload(sectionsData as BylawSectionData[]),
    subsections: cleanArrayForUpload(subsectionsData as BylawSubsectionData[]),
  }
}

/**
 * Test database connection
 */
async function testDatabaseConnection(payload: Payload): Promise<boolean> {
  try {
    // Try a simple query to test connection
    await payload.find({
      collection: 'bylaws',
      limit: 1,
      overrideAccess: true,
    })
    return true
  } catch (error: any) {
    console.error('Database connection test failed:', error.message)
    return false
  }
}

/**
 * Create bylaw documents (major sections)
 * Returns a map of bylaw code to ID
 */
async function createBylaws(
  payload: Payload,
  bylawsData: BylawData[],
): Promise<Map<string, number | string>> {
  console.log(`Creating ${bylawsData.length} bylaw documents...`)

  const bylawCodeMap = new Map<string, number | string>()
  let created = 0
  let skipped = 0

  // Sort bylaws by code
  const sortedBylaws = [...bylawsData].sort((a, b) => {
    const aCode = (a as any).code || ''
    const bCode = (b as any).code || ''
    return aCode.localeCompare(bCode)
  })

  for (const bylawData of sortedBylaws) {
    const bylawCode = (bylawData as any).code || ''
    try {
      // Check if bylaw already exists by code (if code field exists) or title
      const existing = await payload.find({
        collection: 'bylaws',
        where: {
          or: [
            ...(bylawCode
              ? [
                  {
                    title: {
                      equals: bylawData.title,
                    },
                  },
                ]
              : []),
          ],
        },
        limit: 1,
        overrideAccess: true,
      })

      if (existing.docs.length > 0) {
        bylawCodeMap.set(bylawCode || bylawData.title, existing.docs[0].id)
        skipped++
        if (created % 10 === 0 || skipped % 10 === 0) {
          console.log(`  Progress: ${created} created, ${skipped} skipped...`)
        }
        continue
      }
    } catch (error: any) {
      // If query fails, continue to create
    }

    try {
      const result = await payload.create({
        collection: 'bylaws',
        data: {
          title: bylawData.title,
          jurisdiction: bylawData.jurisdiction,
          effectiveDate: bylawData.effectiveDate,
          sortKey: bylawData.sortKey,
        },
        overrideAccess: true,
      })

      bylawCodeMap.set(bylawCode || bylawData.title, result.id)
      created++

      if (created % 10 === 0) {
        console.log(`  Progress: ${created} bylaws created...`)
      }
    } catch (error: any) {
      console.error(`  ❌ Failed to create bylaw ${bylawCode || bylawData.title}:`, error.message)
    }
  }

  console.log(`✓ Created ${created} bylaws (${skipped} skipped)`)
  return bylawCodeMap
}

/**
 * Validate content blocks and remove any id fields
 */
function validateContentBlocks(content: any[]): any[] {
  if (!Array.isArray(content)) {
    return []
  }

  return content
    .map((block, index) => {
      // Ensure block has required fields
      if (!block || typeof block !== 'object') {
        console.warn(`  ⚠ Block at index ${index} is invalid, skipping`)
        return null
      }

      if (!block.blockType) {
        console.warn(`  ⚠ Block at index ${index} missing blockType, skipping`)
        return null
      }

      // Remove id field if present
      const cleanedBlock = { ...block }
      delete cleanedBlock.id

      // Validate block structure based on type
      switch (cleanedBlock.blockType) {
        case 'richText':
          if (!cleanedBlock.body || !cleanedBlock.body.root) {
            console.warn(`  ⚠ RichText block at index ${index} missing body, skipping`)
            return null
          }
          break
        case 'table':
          if (!cleanedBlock.rows || !Array.isArray(cleanedBlock.rows)) {
            console.warn(`  ⚠ Table block at index ${index} missing rows, skipping`)
            return null
          }
          // Clean rows and cells (remove id fields)
          cleanedBlock.rows = cleanedBlock.rows.map((row: any) => {
            const cleanRow = { ...row }
            delete cleanRow.id
            if (cleanRow.cells) {
              cleanRow.cells = cleanRow.cells.map((cell: any) => {
                const cleanCell = { ...cell }
                delete cleanCell.id
                return cleanCell
              })
            }
            return cleanRow
          })
          break
        case 'list':
          if (!cleanedBlock.items || !Array.isArray(cleanedBlock.items)) {
            console.warn(`  ⚠ List block at index ${index} missing items, skipping`)
            return null
          }
          // Clean items (remove id fields)
          cleanedBlock.items = cleanedBlock.items.map((item: any) => {
            const cleanItem = { ...item }
            delete cleanItem.id
            return cleanItem
          })
          break
        case 'image':
          // Keep image blocks; relativePath will be resolved to Media id in resolveContentBlockImages
          if (!cleanedBlock.image || typeof cleanedBlock.image !== 'object') {
            console.warn(`  ⚠ Image block at index ${index} missing image object, skipping`)
            return null
          }
          break
        default:
          console.warn(`  ⚠ Unknown block type: ${cleanedBlock.blockType}, keeping as-is`)
      }

      return cleanedBlock
    })
    .filter(block => block !== null)
}

/**
 * Resolve image blocks that have relativePath: upload file to Media and set block.image to { id }.
 * Blocks that already have image.id are left unchanged.
 */
async function resolveContentBlockImages(
  content: any[],
  dataDir: string,
  payload: Payload,
): Promise<any[]> {
  if (!Array.isArray(content)) return content
  const resolved = []
  for (let i = 0; i < content.length; i++) {
    const block = content[i]
    if (!block || block.blockType !== 'image' || !block.image) {
      resolved.push(block)
      continue
    }
    const relativePath = block.image.relativePath
    if (relativePath) {
      try {
        const fullPath = path.join(dataDir, relativePath)
        await fs.access(fullPath)
        const filename = path.basename(relativePath)
        const mediaDoc = await payload.create({
          collection: 'media',
          data: { alt: block.alt ?? block.caption ?? filename },
          filePath: fullPath,
          overrideAccess: true,
        })
        resolved.push({
          ...block,
          image: { id: mediaDoc.id },
        })
      } catch (err: any) {
        console.warn(
          `  ⚠ Could not upload image ${relativePath}: ${err.message}, keeping block with relativePath`,
        )
        resolved.push(block)
      }
    } else if (block.image.id) {
      resolved.push(block)
    } else {
      resolved.push(block)
    }
  }
  return resolved
}

/**
 * Create sections in order
 * Links each section to its parent bylaw based on the first part of the section code
 */
async function createSections(
  payload: Payload,
  sections: BylawSectionData[],
  bylawCodeMap: Map<string, number | string>,
  dataDir: string,
) {
  console.log(`Creating ${sections.length} sections...`)

  // Sort sections by sortKey to ensure proper order
  const sortedSections = [...sections].sort((a, b) => {
    // Compare sortKeys (they're strings like "0001", "0002", etc.)
    return a.sortKey.localeCompare(b.sortKey)
  })

  const sectionCodeMap = new Map<string, number | string>()
  let created = 0
  let skipped = 0
  let errors = 0

  for (const sectionData of sortedSections) {
    try {
      // Find parent bylaw code (first part of section code, e.g., "2.0" -> "2", "1.1" -> "1")
      const sectionCode = sectionData.code
      const parentBylawCode = sectionCode.includes('.') ? sectionCode.split('.')[0] : sectionCode
      const bylawId = bylawCodeMap.get(parentBylawCode)

      if (!bylawId) {
        console.warn(
          `  ⚠ Could not find parent bylaw for section ${sectionCode} (parent code: ${parentBylawCode})`,
        )
        errors++
        continue
      }

      // Check if section already exists
      const existing = await payload.find({
        collection: 'bylawSections',
        where: {
          and: [
            {
              code: {
                equals: sectionData.code,
              },
            },
            {
              bylaw: {
                equals: bylawId,
              },
            },
          ],
        },
        limit: 1,
        overrideAccess: true,
      })

      if (existing.docs.length > 0) {
        sectionCodeMap.set(sectionData.code, existing.docs[0].id)
        skipped++
        if (created % 100 === 0 || skipped % 100 === 0) {
          console.log(`  Progress: ${created} created, ${skipped} skipped...`)
        }
        continue
      }

      // Validate and clean content blocks
      const validatedContent = validateContentBlocks(sectionData.content)
      const resolvedContent = await resolveContentBlockImages(validatedContent, dataDir, payload)

      // Clean section data (remove any id fields)
      const cleanSectionData = cleanDataForUpload({
        code: sectionData.code,
        title: sectionData.title,
        label: sectionData.label,
        slug: sectionData.slug,
        sortKey: sectionData.sortKey,
        bylaw: bylawId,
        content: resolvedContent,
      })

      const result = await payload.create({
        collection: 'bylawSections',
        data: cleanSectionData as any,
        overrideAccess: true,
      })

      sectionCodeMap.set(sectionData.code, result.id)
      created++

      if (created % 100 === 0) {
        console.log(`  Progress: ${created} sections created...`)
      }
    } catch (error: any) {
      console.error(`  ❌ Failed to create section ${sectionData.code}:`, error.message)
      errors++
    }
  }

  console.log(`✓ Created ${created} sections (${skipped} skipped, ${errors} errors)`)
  return sectionCodeMap
}

/**
 * Find parent section or subsection code for a subsection
 * Prefers sections over subsections when both could match
 */
function findParentCode(
  subsectionCode: string,
  sectionCodeMap: Map<string, number | string>,
  subsectionCodeMap: Map<string, number | string>,
): { code: string; isSubsection: boolean } | undefined {
  const codeParts = subsectionCode.split('.')

  // Try to find parent by matching code prefixes (longest match first)
  // e.g., "2.0.1" -> try "2.0", then "2"
  // Prefer sections over subsections (sections are more stable parents)
  for (let i = codeParts.length - 1; i > 0; i--) {
    const potentialParentCode = codeParts.slice(0, i).join('.')

    // Check if it's a major section first (prefer sections)
    if (sectionCodeMap.has(potentialParentCode)) {
      return { code: potentialParentCode, isSubsection: false }
    }

    // Then check if it's a subsection
    if (subsectionCodeMap.has(potentialParentCode)) {
      return { code: potentialParentCode, isSubsection: true }
    }
  }

  // Also try letter-based codes (B.2.1 -> B.2)
  if (codeParts.length > 1) {
    const letterCode = codeParts[0]
    if (letterCode.match(/^[A-Z]$/)) {
      // Find the closest section/subsection with this letter prefix
      // Prefer sections over subsections
      let bestMatch: string | undefined
      let bestMatchIsSubsection = false
      let bestMatchLength = 0

      // Check sections first (prefer sections)
      for (const code of sectionCodeMap.keys()) {
        if (code.startsWith(letterCode + '.')) {
          const matchLength = code.split('.').length
          // Prefer longer matches (e.g., "B.2" over "B" for "B.2.1")
          if (matchLength > bestMatchLength && codeParts.length > matchLength) {
            bestMatch = code
            bestMatchIsSubsection = false
            bestMatchLength = matchLength
          }
        }
      }

      // Then check subsections
      for (const code of subsectionCodeMap.keys()) {
        if (code.startsWith(letterCode + '.')) {
          const matchLength = code.split('.').length
          if (matchLength > bestMatchLength && codeParts.length > matchLength) {
            bestMatch = code
            bestMatchIsSubsection = true
            bestMatchLength = matchLength
          }
        }
      }

      if (bestMatch) {
        return { code: bestMatch, isSubsection: bestMatchIsSubsection }
      }
    }
  }

  return undefined
}

/**
 * Create subsections in order with proper relationships
 */
async function createSubsections(
  payload: Payload,
  subsections: BylawSubsectionData[],
  sectionCodeMap: Map<string, number | string>,
  dataDir: string,
) {
  console.log(`Creating ${subsections.length} subsections...`)

  // Sort subsections by code to ensure proper order (parent before child)
  const sortedSubsections = [...subsections].sort((a, b) => {
    // Compare codes (e.g., "2.0.1" vs "2.0.2")
    const aParts = a.code.split('.').map(p => {
      const num = parseInt(p, 10)
      return isNaN(num) ? p : String(num).padStart(4, '0')
    })
    const bParts = b.code.split('.').map(p => {
      const num = parseInt(p, 10)
      return isNaN(num) ? p : String(num).padStart(4, '0')
    })

    const aKey = aParts.join('.')
    const bKey = bParts.join('.')
    return aKey.localeCompare(bKey)
  })

  const subsectionCodeMap = new Map<string, number | string>()
  let created = 0
  let skipped = 0
  let errors = 0

  for (const subsectionData of sortedSubsections) {
    try {
      // Find parent (could be a section or subsection)
      const parentInfo = findParentCode(subsectionData.code, sectionCodeMap, subsectionCodeMap)

      if (!parentInfo) {
        console.warn(`  ⚠ Could not find parent for subsection ${subsectionData.code}`)
        errors++
        continue
      }

      // Get parent ID from appropriate map
      let sectionId: number | string | undefined
      let parentSubsectionId: number | string | undefined

      if (parentInfo.isSubsection) {
        // Parent is a subsection - set it as parentSubsection
        parentSubsectionId = subsectionCodeMap.get(parentInfo.code)
        if (!parentSubsectionId) {
          console.warn(`  ⚠ Parent subsection ${parentInfo.code} not found in map`)
          errors++
          continue
        }

        // Get the section ID from the parent subsection by querying the database
        try {
          const parentSubsection = await payload.findByID({
            collection: 'bylawSubsections',
            id: parentSubsectionId,
            overrideAccess: true,
          })
          sectionId =
            typeof parentSubsection.section === 'object'
              ? parentSubsection.section.id
              : parentSubsection.section

          if (!sectionId) {
            console.warn(`  ⚠ Parent subsection ${parentInfo.code} has no section ID`)
            errors++
            continue
          }
        } catch (error: any) {
          console.warn(`  ⚠ Could not find parent subsection ${parentInfo.code}: ${error.message}`)
          errors++
          continue
        }
      } else {
        // Parent is a major section
        sectionId = sectionCodeMap.get(parentInfo.code)
        if (!sectionId) {
          console.warn(`  ⚠ Parent section ${parentInfo.code} not found in map`)
          errors++
          continue
        }

        // Check if there's a more immediate parent subsection (for deeply nested subsections)
        // e.g., "2.0.1.1" -> parent subsection is "2.0.1"
        const codeParts = subsectionData.code.split('.')
        if (codeParts.length > 2) {
          // Try to find a more immediate parent subsection (one level up)
          const immediateParentCode = codeParts.slice(0, codeParts.length - 1).join('.')
          if (
            subsectionCodeMap.has(immediateParentCode) &&
            immediateParentCode !== parentInfo.code
          ) {
            parentSubsectionId = subsectionCodeMap.get(immediateParentCode)
          }
        }
      }

      // Check if subsection already exists
      const existing = await payload.find({
        collection: 'bylawSubsections',
        where: {
          and: [
            {
              code: {
                equals: subsectionData.code,
              },
            },
            {
              section: {
                equals: sectionId,
              },
            },
          ],
        },
        limit: 1,
        overrideAccess: true,
      })

      if (existing.docs.length > 0) {
        subsectionCodeMap.set(subsectionData.code, existing.docs[0].id)
        skipped++
        if (created % 50 === 0 || skipped % 50 === 0) {
          console.log(`  Progress: ${created} created, ${skipped} skipped...`)
        }
        continue
      }

      // Validate and clean content blocks
      const validatedContent = validateContentBlocks(subsectionData.content)
      const resolvedContent = await resolveContentBlockImages(validatedContent, dataDir, payload)

      // Clean subsection data (remove any id fields)
      const cleanSubsectionData = cleanDataForUpload({
        code: subsectionData.code,
        level: subsectionData.level,
        title: subsectionData.title,
        label: subsectionData.label,
        slug: subsectionData.slug,
        sortOrder: subsectionData.sortOrder,
        section: sectionId,
        parentSubsection: parentSubsectionId,
        content: resolvedContent,
      })

      const result = await payload.create({
        collection: 'bylawSubsections',
        data: cleanSubsectionData as any,
        overrideAccess: true,
      })

      subsectionCodeMap.set(subsectionData.code, result.id)
      created++

      if (created % 50 === 0) {
        console.log(`  Progress: ${created} subsections created...`)
      }
    } catch (error: any) {
      console.error(`  ❌ Failed to create subsection ${subsectionData.code}:`, error.message)
      errors++
    }
  }

  console.log(`✓ Created ${created} subsections (${skipped} skipped, ${errors} errors)`)
}

/**
 * Main upload function
 */
async function uploadBylawData() {
  const dbUrl =
    process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL
  if (!dbUrl) {
    throw new Error(
      'Database URL env var is not set. Set DATABASE_URL in .env (see payload.config.ts).',
    )
  }

  if (!process.env.PAYLOAD_SECRET) {
    throw new Error('PAYLOAD_SECRET is not set. Add it to .env or pass it via the environment.')
  }

  // Resolve data directory/ies: CLI args or default single dir
  const dataDirs: string[] =
    process.argv.length > 2 ? process.argv.slice(2).map(p => path.resolve(p)) : [DATA_DIR]

  for (const dataDir of dataDirs) {
    try {
      await fs.access(dataDir)
    } catch {
      throw new Error(
        `Extracted data directory not found: ${dataDir}\nPlease run extract for this bylaw first.`,
      )
    }
  }

  console.log('\nInitializing Payload CMS...')
  const payload = await getPayload({ config })

  console.log('Testing database connection...')
  const dbConnected = await testDatabaseConnection(payload)
  if (!dbConnected) {
    throw new Error(
      'Database connection failed. Please ensure:\n' +
        '  1. Database is running (run: npm run db:start)\n' +
        '  2. Migrations are up to date (run: npm run migrate)\n' +
        '  3. Database URL is correct in .env file',
    )
  }
  console.log('✓ Database connection successful\n')

  for (let i = 0; i < dataDirs.length; i++) {
    const dataDir = dataDirs[i]
    console.log(`[${i + 1}/${dataDirs.length}] Loading from ${dataDir}...`)
    const data = await loadExtractedData(dataDir)
    console.log(
      `  Loaded: ${data.bylaws.length} bylaws, ${data.sections.length} sections, ${data.subsections.length} subsections`,
    )

    const bylawCodeMap = await createBylaws(payload, data.bylaws)
    const sectionCodeMap = await createSections(payload, data.sections, bylawCodeMap, dataDir)
    await createSubsections(payload, data.subsections, sectionCodeMap, dataDir)
  }

  console.log('\n✅ Upload complete!')
}

/**
 * Main execution
 */
async function run() {
  try {
    console.log('Payload CMS Bylaw Data Uploader')
    console.log('================================\n')

    await uploadBylawData()
  } catch (error: any) {
    console.error('\n❌ Upload failed!')
    console.error('Error:', error.message)
    if (error.stack && process.env.DEBUG) {
      console.error('\nStack trace:')
      console.error(error.stack)
    }
    process.exit(1)
  }
}

run()
