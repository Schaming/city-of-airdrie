// scripts/add-lookup-links-to-definition-content.ts
// Walks definition-content rich text and wraps matching terms in link nodes
// with actionKey="lookupDefinition" and actionPayload=<Term>.

import 'dotenv/config';
import config from '@payload-config';
import { getPayload, Payload } from 'payload';

type LexicalNode = {
  type: string;
  version: number;
  [key: string]: any;
};

type LexicalRoot = {
  root: LexicalNode;
};

type TermAlias = {
  alias: string;
  canonical: string;
  contentId: string;
};

const ACTION_KEY = 'lookupDefinition';

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function fetchAllDefinitions(payload: Payload): Promise<TermAlias[]> {
  const aliases: TermAlias[] = [];
  let page = 1;
  while (true) {
    const res = await payload.find({
      collection: 'definitions',
      limit: 100,
      page,
      depth: 0,
      overrideAccess: true,
    });
    res.docs.forEach(doc => {
      if (!doc.term || !doc.definitionContent) return;
      const termStr = String(doc.term).trim();
      if (termStr) {
        aliases.push({
          alias: termStr,
          canonical: termStr,
          contentId: String(doc.definitionContent),
        });
      }
    });
    if (!res.totalPages || page >= res.totalPages) break;
    page += 1;
  }
  return aliases;
}

const buildRegex = (aliases: TermAlias[]) => {
  const escaped = aliases.map(a => escapeRegex(a.alias));
  if (!escaped.length) return null;
  // Longest first to bias toward longer matches when regex engines scan left-to-right
  escaped.sort((a, b) => b.length - a.length);
  // Match the term followed by an optional 's' or 'es' to handle simple plurals
  return new RegExp(`\\b(${escaped.join('|')})(s|es)?\\b`, 'gi');
};

const aliasLookup = (aliases: TermAlias[]) => {
  const map = new Map<string, { canonical: string; contentId: string }>();
  aliases.forEach(a =>
    map.set(a.alias.toLowerCase(), { canonical: a.canonical, contentId: a.contentId }),
  );
  return map;
};

function wrapTextNodeIfMatches(
  node: LexicalNode,
  regex: RegExp,
  aliasMap: Map<string, { canonical: string; contentId: string }>,
  currentContentId: string,
): LexicalNode[] {
  const text: string = node.text;
  if (!text) return [node];

  let lastIndex = 0;
  const pieces: LexicalNode[] = [];

  for (const match of text.matchAll(regex)) {
    const matchText = match[0];
    const baseTerm = match[1]; // The matched term without 's' or 'es'
    const start = match.index ?? 0;
    const end = start + matchText.length;

    const lookup = aliasMap.get(baseTerm.toLowerCase());
    const canonical = lookup?.canonical || baseTerm;
    const targetContentId = lookup?.contentId;

    // Skip self-linking
    if (targetContentId === currentContentId) {
      continue;
    }

    if (start > lastIndex) {
      pieces.push({ ...node, text: text.slice(lastIndex, start) });
    }

    const linkNode: LexicalNode = {
      type: 'link',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      fields: {
        linkType: 'custom',
        url: '#',
        newTab: false,
        actionKey: ACTION_KEY,
        actionPayload: canonical,
      },
      children: [{ ...node, text: matchText }],
    };
    pieces.push(linkNode);
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    pieces.push({ ...node, text: text.slice(lastIndex) });
  }

  return pieces.length ? pieces : [node];
}

function processNode(
  node: LexicalNode,
  regex: RegExp,
  aliasMap: Map<string, { canonical: string; contentId: string }>,
  currentContentId: string,
): { changed: boolean; nodes: LexicalNode[] } {
  // If already a link, check if it's a manual link that we can "upgrade" to a lookup action
  if (node.type === 'link') {
    if (node.fields?.url === '#' && !node.fields?.actionKey) {
      const text = node.children?.[0]?.text || '';
      const match = text.match(regex);
      if (match) {
        const baseTerm = match[1];
        const lookup = aliasMap.get(baseTerm.toLowerCase());
        const canonical = lookup?.canonical || baseTerm;
        const targetContentId = lookup?.contentId;

        // Skip self-linking
        if (targetContentId === currentContentId) {
          return { changed: false, nodes: [node] };
        }

        console.log(`Upgrading manual link in content: "${text}" -> "${canonical}"`);
        return {
          changed: true,
          nodes: [
            {
              ...node,
              fields: {
                ...node.fields,
                actionKey: ACTION_KEY,
                actionPayload: canonical,
              },
            },
          ],
        };
      }
    }
    return { changed: false, nodes: [node] };
  }

  if (node.type === 'text') {
    const wrapped = wrapTextNodeIfMatches(node, regex, aliasMap, currentContentId);
    const changed = wrapped.length !== 1 || wrapped[0] !== node;
    return { changed, nodes: wrapped };
  }

  if (Array.isArray(node.children)) {
    let anyChanged = false;
    const newChildren: LexicalNode[] = [];
    node.children.forEach(child => {
      const res = processNode(child, regex, aliasMap, currentContentId);
      if (res.changed) anyChanged = true;
      newChildren.push(...res.nodes);
    });
    if (anyChanged) {
      return { changed: true, nodes: [{ ...node, children: newChildren }] };
    }
  }

  return { changed: false, nodes: [node] };
}

function processRichText(
  body: LexicalRoot,
  regex: RegExp,
  aliasMap: Map<string, { canonical: string; contentId: string }>,
  currentContentId: string,
) {
  const root = body?.root;
  if (!root || !Array.isArray(root.children)) return { changed: false, body };

  let anyChanged = false;
  const newChildren: LexicalNode[] = [];
  root.children.forEach(child => {
    const res = processNode(child, regex, aliasMap, currentContentId);
    if (res.changed) anyChanged = true;
    newChildren.push(...res.nodes);
  });

  if (!anyChanged) return { changed: false, body };
  return { changed: true, body: { root: { ...root, children: newChildren } } };
}

async function processDefinitionContent(
  payload: Payload,
  regex: RegExp,
  aliasMap: Map<string, { canonical: string; contentId: string }>,
) {
  let page = 1;
  let updated = 0;
  while (true) {
    const res = await payload.find({
      collection: 'definition-content',
      limit: 50,
      page,
      depth: 0,
      overrideAccess: true,
    });

    for (const doc of res.docs) {
      if (!doc.text || typeof doc.text !== 'object') continue;

      const body = doc.text as LexicalRoot;
      const { changed, body: newBody } = processRichText(body, regex, aliasMap, String(doc.id));

      if (changed) {
        try {
          await payload.update({
            collection: 'definition-content',
            id: doc.id,
            data: { text: newBody },
            overrideAccess: true,
          });
          updated += 1;
          console.log(`Updated definition-content ${doc.id} (${doc.termID})`);
        } catch (err: any) {
          console.error('Failed to update definition-content', doc.id);
          if (err?.data) {
            console.error('Error data:', JSON.stringify(err.data, null, 2));
          }
          throw err;
        }
      }
    }

    if (!res.totalPages || page >= res.totalPages) break;
    page += 1;
  }

  console.log(`Finished. Updated ${updated} definition-content records.`);
}

async function start() {
  const dbUrl =
    process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
  if (!dbUrl) {
    throw new Error('Database URL env var is not set (DATABASE_URL).');
  }
  if (!process.env.PAYLOAD_SECRET) {
    throw new Error('PAYLOAD_SECRET is not set. Add it to .env or pass it via the environment.');
  }

  const payload = await getPayload({ config });
  console.log('Fetching definitions...');
  const aliases = await fetchAllDefinitions(payload);
  console.log(`Found ${aliases.length} definition terms.`);
  if (!aliases.length) {
    console.log('No definitions found; exiting.');
    return;
  }
  const regex = buildRegex(aliases);
  if (!regex) {
    console.log('No aliases to match; exiting.');
    return;
  }
  console.log('Starting processing definition-content...');
  const aliasMap = aliasLookup(aliases);
  await processDefinitionContent(payload, regex, aliasMap);
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
