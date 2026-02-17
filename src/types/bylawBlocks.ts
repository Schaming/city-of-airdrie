export type LexicalTextNode = {
  type: 'text';
  text?: string;
  // other Lexical props, we don't care about them here
  [key: string]: unknown;
};

export type LexicalElementNode = {
  type: string;
  children?: LexicalNode[];
  [key: string]: unknown;
};

export type LexicalNode = LexicalTextNode | LexicalElementNode;

export type LexicalRoot = {
  root: LexicalElementNode;
};

export type RichTextBlockData = {
  id?: string | number;
  blockType: 'richText';
  // Adjust to your actual richText structure
  body: LexicalRoot;
};

export type TableCell = {
  colSpan?: number | undefined;
  id: string | number;
  text?: string | null; // legacy
  body?: LexicalRoot;
  isHeader?: boolean | null;
  className?: string | null;
};

export type TableRow = {
  id: string | number;
  cells: TableCell[];
};

export type TableBlockData = {
  id?: string | number;
  title?: string | null;
  titleRich?: LexicalRoot | null;
  blockType: 'table';
  style?: string | null;
  rows: TableRow[];
};

export type ListItem = { text: string };

export type ListBlockData = {
  id?: string | number;
  blockType: 'list';
  /**
   * Payload stores this as `kind`. Keep `listType` for backward compatibility
   * with earlier seeds that used bullet/number.
   */
  kind?: 'ordered' | 'unordered';
  listType?: 'bullet' | 'number';
  /** Numbering style for ordered lists (only when kind === 'ordered'). */
  listStyleType?: 'decimal' | 'upper-roman' | 'lower-roman';
  items: ListItem[];
};

export type ImageBlockData = {
  id?: string | number;
  blockType: 'image';
  image: {
    id: string | number;
    url: string;
    alt?: string;
    width?: number;
    height?: number;
  } | null;
  caption?: string;
  alt?: string;
};

// Discriminated union of all block types
export type BylawBlock = RichTextBlockData | TableBlockData | ListBlockData | ImageBlockData;
