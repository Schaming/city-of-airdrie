// scripts/import-definitions.ts
// Imports definitions2.json into Payload: creates definition-content first, then links definitions
import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import config from '@payload-config';
import { getPayload, Payload } from 'payload';

type DefinitionRow = {
  termID?: string;
  terms?: string;
  text?: string;
  type?: string;
  image?: string;
};

// Recreate __dirname in ESM/tsx
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_PATH = path.resolve(__dirname, './definitions/definitions2.json');

type DefinitionType = 'General' | 'Use' | 'General / Use';

const TYPE_GENERAL: DefinitionType = 'General';
const TYPE_USE: DefinitionType = 'Use';
const TYPE_BOTH: DefinitionType = 'General / Use';

const normalizeType = (raw?: string): DefinitionType => {
  if (!raw) return TYPE_GENERAL;
  const val = raw.trim();
  if (val === TYPE_GENERAL || val === TYPE_USE || val === TYPE_BOTH) return val;
  // Fallback heuristics for non-standard labels found in the spreadsheet
  if (val.toLowerCase().includes('use') && val.toLowerCase().includes('general')) return TYPE_BOTH;
  if (val.toLowerCase().includes('use')) return TYPE_USE;
  return TYPE_GENERAL;
};

function addSpanTags(text: string, allTerms: { name: string; termID: string }[]) {
  if (!text) return '';
  let linkedText = text;
  const sortedTerms = [...allTerms].sort((a, b) => b.name.length - a.name.length);

  sortedTerms.forEach(item => {
    const safeName = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b(${safeName})\\b(?![^<]*>)`, 'gi');
    linkedText = linkedText.replace(
      regex,
      `<span class="def-link" data-id="${item.termID}">$1</span>`,
    );
  });

  return linkedText;
}

function convertToLexicalValue(value: string) {
  const cleanText = value.replace(/<[^>]*>/g, '');

  const lexicalValue = {
    root: {
      direction: null,
      type: 'root',
      format: '' as '' | 'left' | 'start' | 'center' | 'right' | 'end' | 'justify',
      indent: 0,
      version: 1,
      children: [
        {
          type: 'paragraph',
          format: '' as '' | 'left' | 'start' | 'center' | 'right' | 'end' | 'justify',
          indent: 0,
          version: 1,
          children: [
            {
              type: 'text',
              detail: 0,
              format: 0,
              mode: 'normal',
              style: '',
              text: cleanText,
              version: 1,
            },
          ],
        },
      ],
    },
  };

  return lexicalValue as {
    [k: string]: unknown;
    root: {
      type: string;
      direction: 'ltr' | 'rtl' | null;
      format: '' | 'left' | 'start' | 'center' | 'right' | 'end' | 'justify';
      indent: number;
      version: number;
      children: { [k: string]: unknown; type: string; version: number }[];
    };
  };
}

type DefinitionId = string | number;

async function getExistingDefinitionContent(payload: Payload) {
  const map: Record<string, DefinitionId> = {};
  let page = 1;
  while (true) {
    const result = await payload.find({
      collection: 'definition-content',
      limit: 100,
      page,
      depth: 0,
      overrideAccess: true,
    });
    result.docs.forEach(doc => {
      if (doc.termID) map[String(doc.termID).trim()] = String(doc.id);
    });
    if (!result.totalPages || page >= result.totalPages) break;
    page += 1;
  }
  return map;
}

async function getExistingDefinitions(payload: Payload) {
  const map: Record<string, boolean> = {};
  let page = 1;
  while (true) {
    const result = await payload.find({
      collection: 'definitions',
      limit: 100,
      page,
      depth: 0,
      overrideAccess: true,
    });
    result.docs.forEach(doc => {
      if (doc.term) map[String(doc.term).trim()] = true;
    });
    if (!result.totalPages || page >= result.totalPages) break;
    page += 1;
  }
  return map;
}

async function createDefinitionContent(
  payload: Payload,
  row: DefinitionRow,
  processedText: string,
) {
  const result = await payload.create({
    collection: 'definition-content',
    data: {
      termID: row.termID!.trim(),
      text: convertToLexicalValue(processedText),
      type: normalizeType(row.type),
    },
    overrideAccess: true,
  });
  console.log('Created definition-content', row.termID);
  return result.id;
}

async function updateDefinitionContent(payload: Payload, id: DefinitionId, processedText: string) {
  await payload.update({
    collection: 'definition-content',
    id,
    data: { text: convertToLexicalValue(processedText) },
    overrideAccess: true,
  });
  console.log('Updated definition-content', id);
}

async function createDefinition(payload: Payload, term: string, definitionContentId: DefinitionId) {
  await payload.create({
    collection: 'definitions',
    // Payload types expect a DefinitionContent object or numeric id; cast to satisfy TS for import use.
    data: { term: term.trim(), definitionContent: definitionContentId as unknown as number },
    overrideAccess: true,
  });
  console.log('Created definition', term);
}

async function run() {
  const dbUrl =
    process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
  if (!dbUrl) {
    throw new Error(
      'Database URL env var is not set. Set DATABASE_URL in .env (see payload.config.ts).',
    );
  }

  if (!process.env.PAYLOAD_SECRET) {
    throw new Error('PAYLOAD_SECRET is not set. Add it to .env or pass it via the environment.');
  }

  const payload = await getPayload({ config });

  const raw = await fs.readFile(DATA_PATH, 'utf8');
  const rows: DefinitionRow[] = JSON.parse(raw);

  const existingContent = await getExistingDefinitionContent(payload);
  const existingDefs = await getExistingDefinitions(payload);

  const allPossibleTerms: { name: string; termID: string }[] = [];
  rows.forEach(row => {
    if (row.terms && row.termID) {
      row.terms.split(';').forEach(alias => {
        const trimmed = alias.trim();
        if (trimmed) allPossibleTerms.push({ name: trimmed, termID: row.termID!.trim() });
      });
    }
  });

  for (const row of rows) {
    if (!row.termID || !row.text) continue;

    const termsToSearch = allPossibleTerms.filter(t => t.termID !== row.termID!.trim());
    const processedText = addSpanTags(row.text.trim(), termsToSearch);

    const key = row.termID.trim();
    let contentId = existingContent[key];

    if (!contentId) {
      contentId = await createDefinitionContent(payload, row, processedText);
      existingContent[key] = contentId;
    } else {
      await updateDefinitionContent(payload, contentId, processedText);
    }

    if (!row.terms) continue;
    const termsArray = row.terms.split(';');
    for (const term of termsArray) {
      const trimmedTerm = term.trim();
      if (!trimmedTerm) continue;
      if (!existingDefs[trimmedTerm]) {
        await createDefinition(payload, trimmedTerm, contentId);
        existingDefs[trimmedTerm] = true;
      } else {
        console.log('Skipped existing definition term', trimmedTerm);
      }
    }
  }

  console.log('✅ Definitions import finished');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
