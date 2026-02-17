'use client';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection, COMMAND_PRIORITY_EDITOR } from 'lexical';
import { useEffect } from 'react';
import { $insertList, $isListNode } from '@lexical/list';
import {
  $createStyledListNode,
  $getNearestListOrStyledListNode,
  $isStyledListNode,
  type ListStyleType,
  StyledListNode,
} from '@/lexical/nodes/StyledListNode';
import { createCommand } from 'lexical';

export const LIST_STYLE_COMMAND = createCommand<ListStyleType>('LIST_STYLE_COMMAND');

/** Insert an ordered list with the given style (decimal or roman) in one step. */
export const INSERT_STYLED_ORDERED_LIST_COMMAND = createCommand<ListStyleType>('INSERT_STYLED_ORDERED_LIST_COMMAND');

function applyListStyle(listNode: ReturnType<typeof $getNearestListOrStyledListNode>, listStyleType: ListStyleType): void {
  if (!listNode) return;
  if ($isStyledListNode(listNode)) {
    (listNode as StyledListNode).setListStyleType(listStyleType);
    return;
  }
  if ($isListNode(listNode) && listNode.getListType() === 'number') {
    const children = listNode.getChildren();
    const styled = $createStyledListNode(
      listNode.getListType(),
      listNode.getStart(),
      listStyleType,
    );
    for (const child of children) {
      styled.append(child);
    }
    listNode.replace(styled);
  }
}

export function ListStylePlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand<ListStyleType>(
      LIST_STYLE_COMMAND,
      (listStyleType) => {
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const anchor = selection.anchor.getNode();
          const listNode = $getNearestListOrStyledListNode(anchor);
          applyListStyle(listNode, listStyleType);
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand<ListStyleType>(
      INSERT_STYLED_ORDERED_LIST_COMMAND,
      (listStyleType) => {
        editor.update(() => {
          $insertList('number');
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const anchor = selection.anchor.getNode();
          const listNode = $getNearestListOrStyledListNode(anchor);
          applyListStyle(listNode, listStyleType);
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }, [editor]);

  return null;
}
