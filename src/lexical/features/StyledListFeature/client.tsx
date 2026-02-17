'use client';

import { createClientFeature, toolbarTextDropdownGroupWithItems } from '@payloadcms/richtext-lexical/client';
import { $isRangeSelection, $getSelection } from 'lexical';
import type { LexicalEditor } from 'lexical';
import { StyledListNode } from '@/lexical/nodes/StyledListNode';
import { ListStylePlugin, LIST_STYLE_COMMAND, INSERT_STYLED_ORDERED_LIST_COMMAND } from '@/lexical/plugins/ListStylePlugin';
import { $getNearestListOrStyledListNode, $isStyledListNode } from '@/lexical/nodes/StyledListNode';
import type { ListStyleType } from '@/lexical/nodes/StyledListNode';

type ToolbarItemContext = { editor: LexicalEditor; selection: ReturnType<typeof $getSelection> };
/** Toolbar onSelect receives { editor, isActive }; we only use editor but must accept the full shape. */
type ToolbarItemSelectContext = { editor: LexicalEditor; isActive?: boolean };

function ListStyleIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 6h11M10 12h11M10 18h11M4 6v12M4 6l2-2M4 6l2 2" />
    </svg>
  );
}

const LIST_STYLE_OPTIONS: { value: ListStyleType; label: string }[] = [
  { value: 'decimal', label: 'Decimal (1, 2, 3)' },
  { value: 'upper-roman', label: 'Upper Roman (I, II, III)' },
  { value: 'lower-roman', label: 'Lower Roman (i, ii, iii)' },
];

function isInOrderedList(
  editor: import('lexical').LexicalEditor,
  selection: ReturnType<typeof import('lexical').$getSelection>,
) {
  if (!selection || !$isRangeSelection(selection)) return false;
  let result = false;
  editor.getEditorState().read(() => {
    const anchor = selection.anchor.getNode();
    const listNode = $getNearestListOrStyledListNode(anchor);
    if (!listNode) return;
    if ($isStyledListNode(listNode)) {
      result = true;
      return;
    }
    result = listNode.getListType() === 'number';
  });
  return result;
}

function getCurrentListStyle(
  editor: import('lexical').LexicalEditor,
  selection: ReturnType<typeof import('lexical').$getSelection>,
): ListStyleType | null {
  if (!selection || !$isRangeSelection(selection)) return null;
  let result: ListStyleType | null = null;
  editor.getEditorState().read(() => {
    const anchor = selection.anchor.getNode();
    const listNode = $getNearestListOrStyledListNode(anchor);
    if ($isStyledListNode(listNode)) result = listNode.getListStyleType();
    else if (listNode?.getListType() === 'number') result = 'decimal';
  });
  return result;
}

export const StyledListFeatureClient = createClientFeature(() => {
  const listStyleDropdownItems = LIST_STYLE_OPTIONS.map((opt) => ({
    key: `listStyle-${opt.value}`,
    label: opt.label,
    isActive: ({ editor, selection }: ToolbarItemContext) =>
      getCurrentListStyle(editor, selection) === opt.value,
    isEnabled: ({ editor, selection }: ToolbarItemContext) => isInOrderedList(editor, selection),
    onSelect: ({ editor }: ToolbarItemSelectContext) => {
      editor.dispatchCommand(LIST_STYLE_COMMAND, opt.value);
    },
    order: opt.value === 'decimal' ? 0 : opt.value === 'upper-roman' ? 1 : 2,
  }));

  const insertRomanItem = {
    key: 'insertStyledOrderedListRoman',
    ChildComponent: ListStyleIcon,
    label: 'Ordered list (Roman)',
    onSelect: ({ editor }: ToolbarItemSelectContext) => {
      editor.dispatchCommand(INSERT_STYLED_ORDERED_LIST_COMMAND, 'upper-roman');
    },
    order: 11,
  };

  const listStyleGroup = {
    ...toolbarTextDropdownGroupWithItems([
      ...listStyleDropdownItems,
      insertRomanItem,
    ]),
    key: 'listStyle',
    order: 26,
  };

  return {
    nodes: [StyledListNode],
    plugins: [
      {
        Component: ListStylePlugin,
        position: 'normal' as const,
      },
    ],
    toolbarFixed: {
      groups: [listStyleGroup],
    },
    toolbarInline: {
      groups: [listStyleGroup],
    },
  };
});
