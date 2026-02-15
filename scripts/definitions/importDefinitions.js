// run this import twice once for the definitions content then again for the definitions
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '@payload-config';
import { getPayload } from 'payload';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.resolve(__dirname, './definitions2.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

function addSpanTags(text, allTerms) {
  if (!text) return '';
  let linkedText = text;

  const sortedTerms = [...allTerms].sort((a, b) => b.name.length - a.name.length);

  sortedTerms.forEach(item => {
    // Escape parentheses and special characters for Regex safety
    const safeName = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Regex matches whole words (\b) and ignores matches already inside <span> tags
    const regex = new RegExp(`\\b(${safeName})\\b(?![^<]*>)`, 'gi');
    if (linkedText !== text) {
      console.log(`Successfully linked a term in: ${item.termID}`);
    }
    linkedText = linkedText.replace(
      regex,
      `<span class="def-link" data-id="${item.termID}">$1</span>`,
    );
  });

  return linkedText;
}

async function getAllDefinitionContent(payload) {
  try {
    const map = {};
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
        if (doc.termID) map[doc.termID.trim()] = doc.id;
      });
      if (!result.totalPages || page >= result.totalPages) break;
      page += 1;
    }
    return map;
  } catch (err) {
    console.error('Error fetching DefinitionContent:', err);
    return {};
  }
}

async function createDefinitionContent(payload, row, processedText) {
  try {
    const result = await payload.create({
      collection: 'definition-content',
      data: {
        termID: row.termID.trim(),
        text: processedText,
        // collection requires a type; default to General if missing
        type: row.type ? row.type.trim() : 'General',
      },
      overrideAccess: true,
    });
    console.log('Created DefinitionContent:', result.id || row.termID.trim());
    return result.id;
  } catch (err) {
    console.error('Error creating DefinitionContent:', row.termID, err);
    return null;
  }
}

async function getAllDefinitions(payload) {
  try {
    const map = {};
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
        if (doc.term) map[doc.term.trim()] = true;
      });
      if (!result.totalPages || page >= result.totalPages) break;
      page += 1;
    }
    return map;
  } catch (err) {
    console.error('Error fetching Definitions:', err);
    return {};
  }
}

async function createDefinition(payload, term, definitionContentId) {
  try {
    const result = await payload.create({
      collection: 'definitions',
      data: { term: term.trim(), definitionContent: definitionContentId },
      overrideAccess: true,
    });
    console.log('Created Definition:', term, result.id || '');
  } catch (err) {
    console.error('Error creating Definition:', term, err);
  }
}

async function runImport(payload) {
  const existingDefContentMap = await getAllDefinitionContent(payload);
  const existingDefinitionsMap = await getAllDefinitions(payload);

  const allPossibleTerms = [];
  data.forEach(row => {
    if (row.terms && row.termID) {
      const termAliases = row.terms.split(';').map(t => t.trim());
      termAliases.forEach(alias => {
        if (alias) {
          allPossibleTerms.push({ name: alias.trim(), termID: row.termID.trim() });
        }
      });
    }
  });

  for (const row of data) {
    if (!row.termID || !row.text) continue;

    const termsToSearch = allPossibleTerms.filter(t => t.termID !== row.termID);
    const processedText = addSpanTags(row.text.trim(), termsToSearch);

    let defContentId = existingDefContentMap[row.termID.trim()];

    if (!defContentId) {
      defContentId = await createDefinitionContent(payload, row, processedText);
      if (defContentId) existingDefContentMap[row.termID.trim()] = defContentId;
    } else {
      console.log('Updating existing DefinitionContent:', row.termID.trim());
      await payload.update({
        collection: 'definition-content',
        id: defContentId,
        data: { text: processedText },
        overrideAccess: true,
      });
    }

    if (!defContentId) continue;

    if (row.terms) {
      const termsArray = row.terms.split(';');
      for (const term of termsArray) {
        const trimmedTerm = term.trim();
        if (!trimmedTerm) continue;

        if (!existingDefinitionsMap[trimmedTerm]) {
          await createDefinition(payload, trimmedTerm, defContentId);
          existingDefinitionsMap[trimmedTerm] = true;
        } else {
          console.log('Skipped existing Definition term:', trimmedTerm);
        }
      }
    }
  }

  console.log('Import finished!');
}

async function start() {
  const dbUrl = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;

  if (!dbUrl) {
    throw new Error(
      'Database URL env var is not set. Set DATABASE_URL in .env (see payload.config.ts).',
    );
  }

  if (!process.env.PAYLOAD_SECRET) {
    throw new Error(
      'PAYLOAD_SECRET is not set. Add it to .env or pass it via the environment when running this script.',
    );
  }

  const payload = await getPayload({ config });
  await runImport(payload);
  process.exit(0);
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
