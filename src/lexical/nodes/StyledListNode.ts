/**
 * Custom Lexical list node that adds listStyleType (decimal | upper-roman | lower-roman)
 * so ordered lists can be rendered with Roman numerals. Extends ListNode so list
 * behavior (indent, outdent, etc.) is preserved.
 */
import type { DOMExportOutput, EditorConfig, LexicalEditor, LexicalNode, NodeKey } from 'lexical';
import { $applyNodeReplacement } from 'lexical';
import {
  $isListNode,
  type ListType,
  type SerializedListNode,
  ListNode,
} from '@lexical/list';

export type ListStyleType = 'decimal' | 'upper-roman' | 'lower-roman';

export type SerializedStyledListNode = SerializedListNode & {
  listStyleType: ListStyleType;
  type: 'styledlist';
};

export class StyledListNode extends ListNode {
  __listStyleType: ListStyleType;

  constructor(listType: ListType = 'number', start = 1, listStyleType: ListStyleType = 'decimal', key?: NodeKey) {
    super(listType, start, key);
    this.__listStyleType = listStyleType;
  }

  static getType(): 'styledlist' {
    return 'styledlist';
  }

  override getType(): 'styledlist' {
    return 'styledlist';
  }

  override afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__listStyleType = prevNode.__listStyleType;
  }

  getListStyleType(): ListStyleType {
    return this.getLatest().__listStyleType;
  }

  setListStyleType(value: ListStyleType): this {
    const writable = this.getWritable();
    writable.__listStyleType = value;
    return writable;
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.setAttribute('data-list-style-type', this.__listStyleType);
    return dom;
  }

  override updateDOM(prevNode: this, dom: HTMLElement, _config: EditorConfig): boolean {
    if (prevNode.__listStyleType !== this.__listStyleType) {
      dom.setAttribute('data-list-style-type', this.__listStyleType);
    }
    return super.updateDOM(prevNode, dom, _config);
  }

  override exportJSON(): SerializedStyledListNode {
    return {
      ...super.exportJSON(),
      type: 'styledlist',
      listStyleType: this.getListStyleType(),
    };
  }

  static override clone(node: StyledListNode): StyledListNode {
    return new StyledListNode(
      node.__listType,
      node.__start,
      node.__listStyleType,
      node.__key,
    );
  }

  override updateFromJSON(serialized: SerializedStyledListNode): this {
    super.updateFromJSON({
      ...serialized,
      type: 'list',
    } as SerializedListNode);
    this.setListStyleType(serialized.listStyleType ?? 'decimal');
    return this;
  }

  override exportDOM(_editor: LexicalEditor): DOMExportOutput {
    const element = document.createElement(this.getTag());
    element.setAttribute('data-list-style-type', this.__listStyleType);
    if (this.getStart() !== 1) {
      element.setAttribute('start', String(this.getStart()));
    }
    return { element };
  }
}

export function $createStyledListNode(
  listType: ListType = 'number',
  start = 1,
  listStyleType: ListStyleType = 'decimal',
): StyledListNode {
  return $applyNodeReplacement(new StyledListNode(listType, start, listStyleType));
}

export function $isStyledListNode(
  node: LexicalNode | null | undefined,
): node is StyledListNode {
  return node instanceof StyledListNode;
}

/**
 * Find the list node (ListNode or StyledListNode) that contains the given node.
 */
export function $getNearestListOrStyledListNode(node: LexicalNode): ListNode | StyledListNode | null {
  let current: LexicalNode | null = node;
  while (current) {
    if ($isListNode(current) || $isStyledListNode(current)) {
      return current;
    }
    current = current.getParent();
  }
  return null;
}
