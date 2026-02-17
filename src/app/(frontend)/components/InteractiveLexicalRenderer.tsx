'use client';

import React from 'react';
import type { DefaultNodeTypes, SerializedLinkNode } from '@payloadcms/richtext-lexical';
import type { LinkFields } from '@payloadcms/richtext-lexical';
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical';
import {
  RichText,
  LinkJSXConverter,
  type JSXConvertersFunction,
} from '@payloadcms/richtext-lexical/react';
import { ReferenceSidebarContext } from './ReferenceSidebarContext';

type ActionableLinkFields = LinkFields & {
  actionKey?: string;
  actionPayload?: string;
};

function getHrefFromLinkFields(fields: LinkFields | undefined): string | null {
  if (!fields) return null;
  if (fields.linkType !== 'internal') return fields.url ?? null;

  const doc = fields.doc;
  if (!doc?.value) return null;
  const value: any = doc.value;
  const slug: string = value.slug || value.id;

  if (doc.relationTo === 'pages') return `/${slug}`;
  if (doc.relationTo === 'posts') return `/posts/${slug}`;
  return null;
}
function getHref(fields: LinkFields | undefined) {
  // basic: external/custom
  if (!fields) return '#';
  // action links never navigate
  if ((fields as ActionableLinkFields).actionKey) return '#';
  if (fields.linkType !== 'internal') return fields.url ?? '#';
  // internal mapping here if you need it
  return '#';
}
function parseActionHref(href: string) {
  const withoutPrefix = href.slice('action:'.length);
  const [action, qs = ''] = withoutPrefix.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs));
  return { action, params };
}

function runAction(action: string, params: Record<string, string>) {
  // ✅ Put your client-side behavior here:
  if (action === 'scrollTo' && params.id) {
    document.getElementById(params.id)?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (action === 'openModal') {
    // open a modal via a global store/context
    // modalStore.open(params.name)
    return;
  }
  console.log('Unhandled action:', action, params);
}

export function InteractiveLexicalRenderer({ data }: { data: SerializedEditorState }) {
  const sidebar = React.useContext(ReferenceSidebarContext);

  const converters: JSXConvertersFunction<DefaultNodeTypes> = ({ defaultConverters }) => {
    const linkConverters = LinkJSXConverter({});
    const baseLink = linkConverters.link ?? defaultConverters.link;

    const renderBaseLink = (args: any) => {
      if (typeof baseLink === 'function') return baseLink(args);
      if (baseLink != null) return baseLink;
      const node = args.node as any;
      const href = getHref(node?.fields as LinkFields | undefined);
      return <a href={href}>{args.nodesToJSX({ nodes: node.children })}</a>;
    };

    return {
      ...defaultConverters,
      ...linkConverters,
      styledlist: ({ node, nodesToJSX }: { node: any; nodesToJSX: (args: { nodes: any[] }) => React.ReactNode }) => {
        const children = nodesToJSX({ nodes: node.children });
        const listStyleType = node.listStyleType ?? 'decimal';
        return <ol className={`list-${listStyleType}`}>{children}</ol>;
      },
      link: (args: any) => {
        const node = args.node as any;
        const fields = node?.fields as ActionableLinkFields | undefined;
        const href = getHref(fields);

        // Treat it as a definition link if it has the actionKey OR if it's a manual link to '#'
        const isDefinitionLookup =
          fields?.actionKey === 'lookupDefinition' ||
          (fields?.linkType === 'custom' && href === '#');

        if (isDefinitionLookup) {
          const term = fields?.actionPayload ?? '';
          return (
            <a
              href={href}
              onClick={async (e) => {
                e.preventDefault();
                // If actionPayload is missing, try to use the link text as a fallback
                const lookupTerm = term || node.children?.[0]?.text || '';
                if (sidebar) {
                  sidebar.selectTerm(lookupTerm);
                  return;
                }
                alert(`Definition lookup unavailable. Term: ${lookupTerm || 'unknown term'}`);
              }}
              className="def-link"
            >
              {args.nodesToJSX({ nodes: node.children })}
            </a>
          );
        }

        if (typeof href === 'string' && href.startsWith('action:')) {
          const { action, params } = parseActionHref(href);
          return (
            <a
              href={href}
              onClick={e => {
                e.preventDefault();
                runAction(action, params);
              }}
              className="underline"
            >
              {args.nodesToJSX({ nodes: node.children })}
            </a>
          );
        }

        return renderBaseLink(args);
      },
    };
  };

  return <RichText data={data} converters={converters} />;
}
