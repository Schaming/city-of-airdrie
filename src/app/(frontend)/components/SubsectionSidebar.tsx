'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

type SubsectionNavItem = {
  id: string | number;
  slug: string;
  code: string;
  title: string;
  level?: number;
};

type NavNode = {
  id: string | number;
  slug: string;
  code: string;
  title: string;
  level: number;
  children: NavNode[];
};

function buildTree(subsections: SubsectionNavItem[]): NavNode[] {
  const roots: NavNode[] = [];
  const stack: NavNode[] = [];

  subsections.forEach(sub => {
    const level = sub.level ?? 1;
    const node: NavNode = { ...sub, level, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }

    stack.push(node);
  });

  return roots;
}

type Props = {
  subsections: SubsectionNavItem[];
};

export function SubsectionSidebar({ subsections }: Props) {
  const tree = useMemo(() => buildTree(subsections), [subsections]);
  const [openState, setOpenState] = useState<Record<string | number, boolean>>(() =>
    Object.fromEntries(subsections.map(sub => [sub.id, true])),
  );

  const toggle = (id: string | number) => {
    setOpenState(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const renderNode = (node: NavNode) => {
    const isOpen = openState[node.id] ?? true;
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.id} className="space-y-1">
        <div
          className="flex w-full items-center gap-2"
          style={{ marginLeft: `${(node.level - 1) * 12}px` }}
        >
          <a
            href={`#${node.slug}`}
            className="min-w-0 flex-1 break-words hover:underline"
          >
            {node.code} {node.title}
          </a>
          {hasChildren && (
            <button
              type="button"
              onClick={() => toggle(node.id)}
              aria-label={isOpen ? 'Collapse subsection' : 'Expand subsection'}
              className="ml-auto flex h-6 shrink-0 items-center justify-center rounded border px-2 text-xs"
            >
              {isOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>

        {hasChildren && isOpen && (
          <div className="space-y-1">{node.children.map(child => renderNode(child))}</div>
        )}
      </div>
    );
  };

  return <div className="space-y-1">{tree.map(renderNode)}</div>;
}
