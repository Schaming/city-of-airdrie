#!/usr/bin/env python3
"""
Extracts hierarchical bylaw data from PDF and converts to Payload CMS JSON format.
Uses pdfplumber for PDF text and table extraction.
TOC-based approach: Extract table of contents first, then use it to locate all sections.
"""

import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict, field
from collections import defaultdict

try:
    import pdfplumber
except ImportError:
    print("Error: pdfplumber is not installed.")
    print("Please install it with: pip install pdfplumber")
    sys.exit(1)

try:
    from pypdf import PdfReader
except ImportError:
    print("Error: pypdf is required for image extraction.")
    print("Please install with: pip install pypdf")
    sys.exit(1)

try:
    import pymupdf
except ImportError:
    pymupdf = None  # Optional fallback when pypdf finds no images

# Paths
SCRIPT_DIR = Path(__file__).parent
PDF_PATH = SCRIPT_DIR.parent / "Land_Use_Bylaw_consolidated.pdf"
OUTPUT_DIR = SCRIPT_DIR.parent / "extracted-bylaw-data"


@dataclass
class TOCEntry:
    """Represents a table of contents entry."""
    code: Optional[str] = None  # e.g., "2.0.1" or None for major sections
    title: str = ""
    page_ref: str = ""  # e.g., "1-1", "2-1"
    level: int = 0  # 0 = major section, 1+ = subsection
    actual_page: Optional[int] = None  # Mapped PDF page number
    parent_code: Optional[str] = None  # Parent section code
    end_page: Optional[int] = None  # Where this section ends


@dataclass
class SectionContent:
    """Represents extracted section/subsection content."""
    code: str
    title: Optional[str]
    label: str
    level: int
    parent_code: Optional[str]
    start_page: int
    end_page: int
    text_content: str
    tables: List[List[List[str]]] = field(default_factory=list)
    images: List[Dict[str, Any]] = field(default_factory=list)  # [{"page", "path", "index_on_page"}, ...]


@dataclass
class BylawSection:
    """Payload CMS BylawSection structure."""
    code: str
    title: Optional[str]
    label: str
    slug: str
    sortKey: str
    content: List[Dict[str, Any]]


@dataclass
class BylawSubsection:
    """Payload CMS BylawSubsection structure."""
    code: str
    level: Optional[int]
    title: Optional[str]
    label: str
    slug: str
    sortOrder: Optional[int]
    content: List[Dict[str, Any]]


@dataclass
class Bylaw:
    """Payload CMS Bylaw structure."""
    code: str  # Single digit code (1, 2, 3, etc.)
    title: str
    jurisdiction: Optional[str]
    effectiveDate: Optional[str]
    sortKey: str


@dataclass
class ExtractedData:
    """Complete extracted data structure."""
    bylaws: List[Bylaw]  # Major sections (single digits)
    sections: List[BylawSection]  # Double digits
    subsections: List[BylawSubsection]  # Triple digits


def extract_text_and_tables(
    pdf_path: Path,
    start_page: Optional[int] = None,
    end_page: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Extract text and tables from PDF using pdfplumber.
    Returns structured data with text, tables, and page info.
    If start_page and end_page are set (1-based), only that page range is processed.
    """
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    page_range_str = ""
    if start_page is not None and end_page is not None:
        page_range_str = f" (pages {start_page}-{end_page})"
    print(f"Extracting text and tables from PDF{page_range_str}...")

    text_data = []
    all_tables = []

    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        if start_page is not None and end_page is not None:
            # 1-based inclusive range -> 0-based slice
            page_indices = range(
                max(0, start_page - 1),
                min(total_pages, end_page),
            )
            pages_to_process = [pdf.pages[i] for i in page_indices]
            page_numbers = list(range(start_page, min(end_page + 1, total_pages + 1)))
        else:
            pages_to_process = pdf.pages
            page_numbers = list(range(1, total_pages + 1))

        print(f"  Processing {len(pages_to_process)} pages...")

        for page_num, page in zip(page_numbers, pages_to_process):
            full_text = page.extract_text() or ""
            tables = page.extract_tables()

            text_data.append({
                "page": page_num,
                "full_text": full_text,
            })

            for table in tables:
                if table:
                    all_tables.append({
                        "page": page_num,
                        "table": table,
                    })

            if len(text_data) % 50 == 0 and len(text_data) > 0:
                print(f"  Processed {len(text_data)} pages...")

    print(f"✓ Extracted text from {len(text_data)} pages")
    print(f"✓ Found {len(all_tables)} tables")

    return {
        "text_data": text_data,
        "tables": all_tables,
    }


def extract_and_save_images(
    pdf_path: Path,
    output_dir: Path,
    start_page: Optional[int] = None,
    end_page: Optional[int] = None,
    min_size: int = 50,
) -> List[Dict[str, Any]]:
    """
    Extract images from PDF using pypdf, save to output_dir/images/, and return
    records for association: [{"page": int, "path": str (relative), "index_on_page": int}, ...].
    Paths are relative to output_dir. Optional min_size (width or height) skips tiny images.
    """
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    page_range_str = ""
    if start_page is not None and end_page is not None:
        page_range_str = f" (pages {start_page}-{end_page})"
    print(f"Extracting images from PDF{page_range_str}...")

    result: List[Dict[str, Any]] = []
    reader = PdfReader(str(pdf_path))
    total_pages = len(reader.pages)

    if start_page is not None and end_page is not None:
        page_indices = range(
            max(0, start_page - 1),
            min(total_pages, end_page),
        )
        page_numbers = list(range(start_page, min(end_page + 1, total_pages + 1)))
    else:
        page_indices = range(total_pages)
        page_numbers = list(range(1, total_pages + 1))

    for page_num, page_idx in zip(page_numbers, page_indices):
        page = reader.pages[page_idx]
        try:
            resources = page.get("/Resources")
            if not resources:
                continue
            # Resolve indirect reference if needed (Resources may be an IndirectObject)
            if hasattr(reader, "get_object") and getattr(resources, "indirect_reference", None) is not None:
                try:
                    resources = reader.get_object(resources)
                except Exception:
                    pass
            if not resources or not hasattr(resources, "get"):
                continue
            xobject = resources.get("/XObject")  # may be None or indirect ref
            if xobject is None:
                continue
            # Resolve indirect reference if needed (pypdf stores refs as IndirectObject)
            if hasattr(reader, "get_object") and getattr(xobject, "indirect_reference", None) is not None:
                try:
                    xobject = reader.get_object(xobject)
                except Exception:
                    pass
            if not xobject or not hasattr(xobject, "get"):
                continue
            index_on_page = 0
            for name in xobject:
                try:
                    obj = xobject[name]
                    if hasattr(reader, "get_object") and getattr(obj, "indirect_reference", None) is not None:
                        try:
                            obj = reader.get_object(obj)
                        except Exception:
                            continue
                    if not hasattr(obj, "get"):
                        continue
                    # Key-agnostic Subtype check (pypdf may use NameObject("/Image"))
                    subtype = obj.get("/Subtype")
                    if subtype is None or "/Image" not in str(subtype):
                        continue
                    width = obj.get("/Width") or 0
                    height = obj.get("/Height") or 0
                    if min_size and (width < min_size or height < min_size):
                        continue
                    data = obj.get_data() if hasattr(obj, "get_data") else None
                    if not data:
                        continue
                    filt = obj.get("/Filter")
                    if isinstance(filt, list):
                        filt = filt[0] if filt else None
                    ext = ".png"
                    if filt == "/DCTDecode":
                        ext = ".jpg"
                    elif filt == "/JPXDecode":
                        ext = ".jp2"
                    filename = f"page-{page_num}-{index_on_page}{ext}"
                    rel_path = f"images/{filename}"
                    out_path = output_dir / rel_path
                    with open(out_path, "wb") as f:
                        f.write(data)
                    result.append({
                        "page": page_num,
                        "path": rel_path,
                        "index_on_page": index_on_page,
                    })
                    index_on_page += 1
                except Exception:
                    continue
        except Exception:
            continue

    # PyMuPDF fallback when pypdf finds no images (e.g. Acrobat-style or inline images)
    if len(result) == 0 and pymupdf is not None:
        try:
            doc = pymupdf.open(str(pdf_path))
            try:
                for i, page_idx in enumerate(page_indices):
                    page_num = page_numbers[i]
                    page = doc[page_idx]
                    index_on_page = 0
                    # PyMuPDF: get_text("dict") returns all images (xref + inline) as blocks with type==1
                    try:
                        text_dict = page.get_text("dict")
                        blocks = text_dict.get("blocks") or []
                        for block in blocks:
                            if block.get("type") != 1:
                                continue
                            data = block.get("image")
                            if not data:
                                continue
                            w = block.get("width") or 0
                            h = block.get("height") or 0
                            if min_size and (w < min_size or h < min_size):
                                continue
                            ext = block.get("ext", "png")
                            if ext and not ext.startswith("."):
                                ext = "." + ext
                            filename = f"page-{page_num}-{index_on_page}{ext}"
                            rel_path = f"images/{filename}"
                            out_path = output_dir / rel_path
                            with open(out_path, "wb") as f:
                                f.write(data)
                            result.append({
                                "page": page_num,
                                "path": rel_path,
                                "index_on_page": index_on_page,
                            })
                            index_on_page += 1
                    except Exception:
                        pass
            finally:
                doc.close()
            if result:
                print(f"  (PyMuPDF fallback: extracted {len(result)} images)")
        except Exception as e:
            print(f"  ⚠ PyMuPDF fallback failed: {e}")

    print(f"✓ Extracted {len(result)} images to {images_dir}")
    return result


def extract_table_of_contents(pdf, max_toc_pages: int = 15) -> List[TOCEntry]:
    """
    Extract and parse table of contents from the beginning of the PDF.
    Returns list of TOC entries with codes, titles, and page references.
    """
    print("Extracting table of contents...")
    
    toc_entries = []
    toc_text = ""
    toc_start_page = None
    toc_end_page = None
    
    # Find TOC section
    for page_num in range(1, min(max_toc_pages + 1, len(pdf.pages) + 1)):
        page = pdf.pages[page_num - 1]
        text = page.extract_text() or ""
        
        # Look for "Table of Contents" header
        if "Table of Contents" in text or "TABLE OF CONTENTS" in text.upper():
            if toc_start_page is None:
                toc_start_page = page_num
            toc_text += text + "\n"
            toc_end_page = page_num
        elif toc_start_page is not None:
            # Continue collecting TOC until we hit a major section
            # Stop if we see a pattern like "1 Legal and Interpretation" (actual content)
            if re.search(r'^\d+\s+[A-Z][^.]{15,}', text, re.MULTILINE):
                break
            toc_text += text + "\n"
            toc_end_page = page_num
    
    if not toc_text:
        print("  ⚠ Could not find table of contents")
        return []
    
    print(f"  Found TOC on pages {toc_start_page}-{toc_end_page}")
    
    # Parse TOC entries - TEXT-BASED approach (numbers may be images)
    # Extract entries by matching titles, then find codes in document body
    lines = toc_text.split('\n')
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # Skip headers and separators
        if "Table of Contents" in line or "TABLE OF CONTENTS" in line:
            continue
        if re.match(r'^[-=]+$', line):  # Separator lines
            continue
        
        # Extract title and page reference (ignore codes in TOC since they may be images)
        # Pattern: Title with optional page reference at end (e.g., "Title ................ 1-1")
        # Or: Title without page ref
        title_match = re.search(r'^(.+?)(?:\s*\.+\s*(\d+-\d+))?$', line)
        if title_match:
            title = title_match.group(1).strip()
            # Remove trailing dots/spaces from title
            title = re.sub(r'[.\s]+$', '', title)
            page_ref = title_match.group(2) or ""
            
            # Skip if title is too short or looks like a separator
            if len(title) < 3 or title in ['', '.', '-']:
                continue
            
            # Skip very short lines that are likely not real entries
            # Real section titles are usually at least 5 characters
            if len(title) < 5:
                continue
            
            # Skip lines that are just numbers or page references
            if re.match(r'^\d+(-\d+)?$', title):
                continue
            
            # Create entry without code - we'll find the code in the document body
            entry = TOCEntry(
                code=None,  # Will be found in document body
                title=title,
                page_ref=page_ref,
                level=0,  # Will be determined later
                parent_code=None,
            )
            toc_entries.append(entry)
    
    print(f"  ✓ Extracted {len(toc_entries)} TOC entries")
    
    # Debug: Show breakdown by level
    level_0 = [e for e in toc_entries if e.level == 0]
    level_1 = [e for e in toc_entries if e.code and e.code.count('.') == 1]
    level_2_plus = [e for e in toc_entries if e.code and e.code.count('.') >= 2]
    print(f"    - Level 0 (major sections): {len(level_0)}")
    print(f"    - Level 1 (sections): {len(level_1)}")
    print(f"    - Level 2+ (subsections): {len(level_2_plus)}")
    if level_0:
        sample = [(e.code or 'NO_CODE') + ' ' + e.title for e in level_0[:3]]
        print(f"    - Sample major sections: {sample}")
    
    return toc_entries


def find_section_in_pdf(section_code: Optional[str], title: str, start_search_page: int, pdf, text_data: List[Dict]) -> Optional[int]:
    """
    Find the actual PDF page number where a section appears.
    Searches by TITLE ONLY (codes may be images).
    """
    # Search for title (first few significant words)
    title_words = [w for w in title.split() if len(w) > 2][:5]  # First 5 significant words
    if len(title_words) < 2:
        # If title is too short, use all words
        title_words = title.split()[:5]
    
    if len(title_words) >= 2:
        # Create pattern with first 2-3 words (more reliable than full title)
        num_words = min(3, len(title_words))
        title_pattern = r'\b' + r'\s+'.join([re.escape(w) for w in title_words[:num_words]]) + r'\b'
        
        for page_data in text_data:
            page_num = page_data['page']
            if page_num < start_search_page:
                continue
            
            text = page_data['full_text']
            if re.search(title_pattern, text, re.IGNORECASE):
                return page_num
    
    return None


def find_code_for_title(title: str, text_data: List[Dict], start_page: int = 1) -> Optional[Tuple[str, int]]:
    """
    Try to find the code for a title by searching the document body.
    Since codes may be images, we search for the title first, then look for codes nearby.
    Returns (code, page_number) or None if code not found (but page may still be found).
    """
    # Clean title for matching (first few significant words)
    title_words = [w for w in title.split() if len(w) > 2][:5]
    if len(title_words) < 2:
        return None
    
    # Create title pattern (first 3 words)
    title_pattern = r'\b' + r'\s+'.join([re.escape(w) for w in title_words[:3]]) + r'\b'
    
    # First, find where the title appears (and which line index)
    title_page = None
    title_line = None
    title_line_idx = -1
    page_lines = []

    for page_data in text_data:
        if page_data['page'] < start_page:
            continue

        text = page_data['full_text']
        lines = text.split('\n')

        for idx, line in enumerate(lines):
            if re.search(title_pattern, line, re.IGNORECASE):
                title_page = page_data['page']
                title_line = line
                title_line_idx = idx
                page_lines = lines
                break

        if title_page:
            break

    if not title_page or not title_line:
        return None

    # Now try to find code patterns near the title
    # Pattern 1: Triple digit (e.g., "2.0.1 Title")
    # Pattern 2: Double digit (e.g., "2.0 Title")
    # Pattern 3: Single digit (e.g., "2 Title")
    patterns_same_line = [
        (r'(\d+\.\d+\.\d+)\s+' + title_pattern, 2),  # Triple digit
        (r'(\d+\.\d+)\s+' + title_pattern, 1),  # Double digit
        (r'(\d+)\s+' + title_pattern, 0),  # Single digit
    ]

    # Check the line where title was found (code + title on same line)
    for pattern, level in patterns_same_line:
        match = re.search(pattern, title_line, re.IGNORECASE)
        if match:
            code = match.group(1)
            return (code, title_page)

    # Code may be on the previous line (e.g. "9.2" on one line, "Zone Symbols" on next)
    # Match standalone section numbers: "9.2", "2.0", "2.0.1", "1"
    standalone_patterns = [
        (r'^\s*(\d+\.\d+\.\d+)\s*$', 2),  # Triple digit only
        (r'^\s*(\d+\.\d+)\s*$', 1),       # Double digit only
        (r'^\s*(\d+)\s*$', 0),            # Single digit only
    ]
    for prev_idx in (title_line_idx - 1, title_line_idx - 2):
        if prev_idx < 0 or prev_idx >= len(page_lines):
            continue
        prev_line = page_lines[prev_idx].strip()
        if not prev_line:
            continue
        for pattern, level in standalone_patterns:
            match = re.match(pattern, prev_line)
            if match:
                code = match.group(1)
                return (code, title_page)

    # If no code found, return None (we'll infer hierarchy from page order)
    return None


def normalize_title_for_match(title: str) -> str:
    """Normalize title for matching: lowercase, collapse whitespace, strip trailing punctuation."""
    if not title:
        return ""
    s = re.sub(r"\s+", " ", title).strip().lower()
    s = re.sub(r"[.:,;]+$", "", s)
    return s


def _title_phrase_pattern_for_trim(title: str, num_words: int = 3):
    """
    Build a regex that matches a line containing the first 2-3 significant words of the title.
    Used to trim section content at the next entry's title when section numbers are images.
    Returns compiled regex or None.
    """
    if not title or not title.strip():
        return None
    normalized = normalize_title_for_match(title)
    words = [w for w in normalized.split() if len(w) > 1][:num_words]
    if not words:
        return None
    pattern = r"\b" + r"\s+".join(re.escape(w) for w in words) + r"\b"
    return re.compile(pattern, re.IGNORECASE)


def _title_match_variants(normalized: str) -> List[str]:
    """Return variants for common PDF typos (e.g. Proces vs Process, Authoritie vs Authorities)."""
    variants = [normalized]
    if "process" in normalized and "proces " not in normalized:
        variants.append(normalized.replace("process", "proces"))
    if "authorities" in normalized:
        variants.append(normalized.replace("authorities", "authoritie"))
    return variants


def find_section_page_by_title(
    title: str,
    text_data: List[Dict],
    start_from_page: Optional[int] = None,
    end_at_page: Optional[int] = None,
) -> Optional[int]:
    """
    Find the first PDF page (within text_data) where the title text appears.
    Uses normalized matching and optional typo variants. Searches in order.
    """
    normalized = normalize_title_for_match(title)
    if len(normalized) < 3:
        return None

    # Try exact phrase: first 5+ significant words
    words = [w for w in normalized.split() if len(w) > 1][:6]
    if not words:
        return None
    pattern_exact = r"\b" + r"\s+".join(re.escape(w) for w in words) + r"\b"
    variants = _title_match_variants(normalized)
    patterns = [re.compile(re.escape(v), re.IGNORECASE) for v in variants]
    if words:
        patterns.insert(0, re.compile(pattern_exact, re.IGNORECASE))

    for page_data in text_data:
        page_num = page_data["page"]
        if start_from_page is not None and page_num < start_from_page:
            continue
        if end_at_page is not None and page_num > end_at_page:
            continue
        text = page_data.get("full_text") or ""
        if not text:
            continue
        text_norm = re.sub(r"\s+", " ", text)
        for pattern in patterns:
            if pattern.search(text_norm):
                return page_num
    return None


def build_toc_entries_from_config(
    bylaw_code: str,
    bylaw_title: str,
    sections: List[Dict[str, str]],
    subsections: List[Dict[str, str]],
) -> List[TOCEntry]:
    """
    Build TOC entries from config: sections and subsections in document order (by code).
    Each entry has code and title from config; level and parent_code derived from code.
    Does not include the bylaw itself as a TOC entry (bylaw is metadata only).
    """
    # Merge sections and subsections and sort by code to get document order
    entries_raw = []
    for s in sections:
        entries_raw.append((s["code"], s["title"], 1, None))  # level 1, parent from code
    for s in subsections:
        entries_raw.append((s["code"], s["title"], 2, None))

    def code_sort_key(item: Tuple[str, str, int, Optional[str]]) -> Tuple[int, ...]:
        code = item[0]
        parts = code.split(".")
        return tuple(int(p) if p.isdigit() else 0 for p in parts)

    entries_raw.sort(key=code_sort_key)

    toc_entries = []
    code_map: Dict[str, TOCEntry] = {}

    for code, title, level, _ in entries_raw:
        parent_code = None
        if level == 1:
            parent_code = code.split(".")[0] if "." in code else None
        else:
            parts = code.split(".")
            if len(parts) >= 2:
                parent_code = ".".join(parts[:2])

        entry = TOCEntry(
            code=code,
            title=title,
            page_ref="",
            level=level,
            actual_page=None,
            parent_code=parent_code,
            end_page=None,
        )
        code_map[code] = entry
        toc_entries.append(entry)

    return toc_entries


def map_config_toc_to_pages(
    toc_entries: List[TOCEntry],
    text_data: List[Dict],
    last_page_in_range: int,
) -> List[TOCEntry]:
    """
    Map config TOC entries to PDF pages by searching for each title in text_data (page range).
    Sets actual_page and end_page for each entry. No reliance on codes in the PDF.
    """
    print("Mapping config TOC entries to PDF pages (title search)...")
    min_page = min((d["page"] for d in text_data), default=1)
    max_page = max((d["page"] for d in text_data), default=last_page_in_range)

    for i, entry in enumerate(toc_entries):
        start_search = toc_entries[i - 1].actual_page if i > 0 else min_page
        actual_page = find_section_page_by_title(
            entry.title,
            text_data,
            start_from_page=start_search,
            end_at_page=max_page,
        )
        if actual_page is not None:
            entry.actual_page = actual_page
        else:
            prev_actual = toc_entries[i - 1].actual_page if i > 0 else None
            entry.actual_page = (prev_actual + 1) if prev_actual is not None else min_page
            print(f"  ⚠ Title not found: '{entry.title}' (code {entry.code}), using page {entry.actual_page}")

    for i, entry in enumerate(toc_entries):
        if i < len(toc_entries) - 1:
            next_actual = toc_entries[i + 1].actual_page
            entry.end_page = (next_actual - 1) if next_actual is not None else (entry.actual_page or max_page)
            # Ensure section gets at least its own page when next section starts on same page
            if entry.actual_page is not None and entry.end_page < entry.actual_page:
                entry.end_page = entry.actual_page
        else:
            entry.end_page = max_page

    mapped_count = sum(1 for e in toc_entries if e.actual_page)
    print(f"  ✓ Mapped {mapped_count}/{len(toc_entries)} entries to PDF pages")
    return toc_entries


def map_toc_to_pages(toc_entries: List[TOCEntry], pdf, text_data: List[Dict]) -> List[TOCEntry]:
    """
    Map TOC entries to actual PDF pages and find codes in document body.
    Since TOC numbers may be images, we search the document body for codes.
    """
    print("Mapping TOC entries to PDF pages and finding codes...")
    
    # First, try to find where TOC ends
    toc_end_page = 1
    for page_data in text_data[:20]:
        text = page_data['full_text']
        if re.search(r'^[1-9]\s+[A-Z][^.]{15,}', text, re.MULTILINE):
            toc_end_page = page_data['page']
            break
    
    mapped_entries = []
    last_mapped_page = toc_end_page
    
    for i, entry in enumerate(toc_entries):
        # Search for entry by title (codes may be images)
        start_search = max(toc_end_page, last_mapped_page)
        actual_page = find_section_in_pdf(None, entry.title, start_search, pdf, text_data)
        
        if actual_page:
            entry.actual_page = actual_page
            last_mapped_page = actual_page
            
            # Try to find code near where we found the title
            if not entry.code:
                result = find_code_for_title(entry.title, text_data, actual_page)
                if result:
                    entry.code, _ = result
        else:
            # If not found by title, estimate based on previous entry or page_ref
            if mapped_entries:
                entry.actual_page = last_mapped_page + 1
            else:
                try:
                    page_num = int(entry.page_ref.split('-')[0]) if entry.page_ref else toc_end_page + 1
                    entry.actual_page = page_num
                    last_mapped_page = page_num
                except:
                    entry.actual_page = toc_end_page + 1
                    last_mapped_page = entry.actual_page
        
        # Set end_page based on next entry
        if i < len(toc_entries) - 1:
            next_entry = toc_entries[i + 1]
            if next_entry.actual_page:
                entry.end_page = next_entry.actual_page - 1
                # Ensure double-digit sections get at least their own page when the first
                # subsection starts on the same page (so intro text is not lost)
                if entry.actual_page is not None and entry.end_page < entry.actual_page:
                    entry.end_page = entry.actual_page
            else:
                # Estimate end page
                entry.end_page = entry.actual_page + 5 if entry.actual_page else 5  # Default 5 pages per section
        else:
            # Last entry: use last page of PDF
            entry.end_page = len(pdf.pages)
        
        mapped_entries.append(entry)
    
    # Map inferred sections (they might not have been in the original mapping)
    for entry in mapped_entries:
        if not entry.actual_page and entry.code:
            # Try to find it in the document
            actual_page = find_section_in_pdf(entry.code, entry.title, toc_end_page, pdf, text_data)
            if actual_page:
                entry.actual_page = actual_page
    
    mapped_count = sum(1 for e in mapped_entries if e.actual_page)
    print(f"  ✓ Mapped {mapped_count}/{len(mapped_entries)} entries to PDF pages")
    
    return mapped_entries


def determine_code_level(code: Optional[str]) -> int:
    """
    Determine the level based on code structure:
    - Single digit (1, 2, 3) = 0 (major section)
    - Double digit (2.0, 2.1, 2.4) = 1 (section)
    - Triple digit (2.4.1, 2.4.2) = 2 (subsection)
    """
    if not code:
        return 0
    
    # Count dots to determine level
    dot_count = code.count('.')
    
    if dot_count == 0:
        # Single digit: "1", "2", "3", "A", "B"
        return 0  # Major section
    elif dot_count == 1:
        # Double digit: "2.0", "2.1", "2.4"
        return 1  # Section
    else:
        # Triple or more: "2.4.1", "2.4.2"
        return 2  # Subsection


def build_section_hierarchy(toc_entries: List[TOCEntry]) -> List[TOCEntry]:
    """
    Build parent-child relationships for TOC entries.
    If codes are available, use code structure.
    Otherwise, infer hierarchy from page order and title patterns.
    """
    print("Building section hierarchy...")
    
    # Sort entries by page number (if available) to establish order
    entries_with_pages = [e for e in toc_entries if e.actual_page]
    entries_without_pages = [e for e in toc_entries if not e.actual_page]
    sorted_entries = sorted(entries_with_pages, key=lambda e: e.actual_page or 0) + entries_without_pages
    
    # Create a map of codes to entries
    code_map = {}
    for entry in toc_entries:
        if entry.code:
            code_map[entry.code] = entry
            # Update level based on code structure
            entry.level = determine_code_level(entry.code)
        else:
            # If no code, we'll infer level from page order and title patterns
            entry.level = -1  # Mark as undetermined
    
    # Build hierarchy based on code structure
    for entry in toc_entries:
        if not entry.code:
            continue
        
        code_parts = entry.code.split('.')
        dot_count = len(code_parts) - 1
        
        if dot_count == 0:
            # Single digit - major section, no parent
            entry.parent_code = None
            entry.level = 0
        elif dot_count == 1:
            # Double digit - section, parent is single digit
            parent_code = code_parts[0]  # e.g., "2.0" -> parent "2"
            if parent_code in code_map:
                entry.parent_code = parent_code
            entry.level = 1
        else:
            # Triple digit or more - subsection, parent is double digit
            parent_code = '.'.join(code_parts[:2])  # e.g., "2.4.1" -> parent "2.4"
            if parent_code in code_map:
                entry.parent_code = parent_code
            else:
                # Fallback: try single digit parent
                parent_code = code_parts[0]
                if parent_code in code_map:
                    entry.parent_code = parent_code
            entry.level = 2
    
    # Infer missing major sections (single digit) and intermediate sections (double digit)
    # If we have subsections like "2.0.1", we need:
    # 1. Major section "2" (if it doesn't exist)
    # 2. Section "2.0" (if it doesn't exist)
    inferred_major_sections = {}
    inferred_sections = {}
    
    for entry in toc_entries:
        if entry.code and entry.level >= 2:  # Triple digit or more
            code_parts = entry.code.split('.')
            if len(code_parts) >= 2:
                # Infer major section (single digit)
                single_digit_code = code_parts[0]
                if single_digit_code not in code_map and single_digit_code not in inferred_major_sections:
                    # Create inferred major section
                    inferred_major = TOCEntry(
                        code=single_digit_code,
                        title=f"Section {single_digit_code}",  # Will be updated if we find a better title
                        page_ref=entry.page_ref,  # Use same page as first subsection
                        level=0,
                        parent_code=None,
                    )
                    inferred_major_sections[single_digit_code] = inferred_major
                    code_map[single_digit_code] = inferred_major
                
                # Infer intermediate section (double digit)
                double_digit_code = '.'.join(code_parts[:2])
                if double_digit_code not in code_map and double_digit_code not in inferred_sections:
                    inferred_entry = TOCEntry(
                        code=double_digit_code,
                        title=f"Section {double_digit_code}",  # Generic title
                        page_ref=entry.page_ref,  # Use same page as first subsection
                        level=1,
                        parent_code=single_digit_code,
                    )
                    inferred_sections[double_digit_code] = inferred_entry
                    code_map[double_digit_code] = inferred_entry
    
    # Add inferred major sections and sections to TOC entries
    if inferred_major_sections:
        inferred_major_list = sorted(inferred_major_sections.values(), key=lambda e: e.code or '')
        toc_entries.extend(inferred_major_list)
        print(f"  ✓ Inferred {len(inferred_major_sections)} missing major sections")
    if inferred_sections:
        inferred_list = sorted(inferred_sections.values(), key=lambda e: e.code or '')
        toc_entries.extend(inferred_list)
        print(f"  ✓ Inferred {len(inferred_sections)} missing intermediate sections")
    
    # Handle entries without codes - infer hierarchy from page order
    entries_without_codes = [e for e in toc_entries if not e.code and e.actual_page]
    if entries_without_codes:
        # Sort by page number
        entries_without_codes.sort(key=lambda e: e.actual_page or 0)
        
        # Group by page proximity (entries on same or nearby pages might be related)
        # For now, assign levels based on title length and page order
        # Longer, more general titles are likely major sections
        # Shorter, specific titles are likely subsections
        for entry in entries_without_codes:
            title_len = len(entry.title)
            # Heuristic: longer titles (30+ chars) are likely major sections
            # Medium titles (15-30 chars) are likely sections
            # Shorter titles (<15 chars) are likely subsections
            if title_len >= 30:
                entry.level = 0  # Major section
            elif title_len >= 15:
                entry.level = 1  # Section
            else:
                entry.level = 2  # Subsection
    
    # Count sections and subsections
    sections = [e for e in toc_entries if e.code and e.level <= 1]  # Entries with codes
    subsections = [e for e in toc_entries if e.code and e.level >= 2]  # Entries with codes
    
    # Also count entries without codes
    entries_no_code = [e for e in toc_entries if not e.code]
    print(f"  ✓ Built hierarchy: {len(sections)} sections, {len(subsections)} subsections")
    if entries_no_code:
        print(f"  ⚠ {len(entries_no_code)} entries without codes (hierarchy inferred from page order)")
    
    return toc_entries


def extract_sections_from_toc(
    toc_entries: List[TOCEntry],
    pdf,
    text_data: List[Dict],
    all_tables: List[Dict],
    all_images: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[List[SectionContent], Dict[str, List[List[List[str]]]], Dict[str, List[Dict[str, Any]]]]:
    """
    Extract content for each TOC entry, including text, tables, and images.
    Returns (sections, section_tables_map, section_images_map)
    """
    print("Extracting section content from TOC entries...")
    
    sections = []
    section_tables_map = defaultdict(list)
    section_images_map: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    
    # Associate tables with sections based on page numbers
    for table_info in all_tables:
        table_page = table_info['page']
        table = table_info['table']
        
        # Find which section this table belongs to
        for entry in toc_entries:
            if entry.actual_page and entry.end_page:
                if entry.actual_page <= table_page <= entry.end_page:
                    # Use code or title as key
                    key = entry.code or entry.title
                    section_tables_map[key].append(table)
                    break
    
    # Associate images with sections based on page numbers
    if all_images:
        for img in all_images:
            img_page = img.get("page")
            if img_page is None:
                continue
            for entry in toc_entries:
                if entry.actual_page and entry.end_page:
                    if entry.actual_page <= img_page <= entry.end_page:
                        key = entry.code or entry.title
                        section_images_map[key].append(img)
                        break
        # Sort each section's images by (page, index_on_page)
        for key in section_images_map:
            section_images_map[key].sort(key=lambda x: (x.get("page", 0), x.get("index_on_page", 0)))
    
    # Extract content for each TOC entry
    for idx, entry in enumerate(toc_entries):
        if not entry.actual_page:
            continue

        # Extract text from page range
        start_page = entry.actual_page
        end_page = entry.end_page or (start_page + 5)  # Default 5 pages if not set

        # When the next entry starts on the same page, trim this entry's first page at that
        # header so content is not duplicated. Trim by next entry's title (section numbers are
        # often images) with optional code fallback when code appears in text.
        next_entry = toc_entries[idx + 1] if idx + 1 < len(toc_entries) else None
        trim_at_code = None
        trim_at_title_pattern = None
        if next_entry and next_entry.actual_page == start_page:
            if next_entry.code:
                trim_at_code = next_entry.code
            if next_entry.title:
                trim_at_title_pattern = _title_phrase_pattern_for_trim(next_entry.title)

        text_content = ""
        for page_data in text_data:
            page_num = page_data['page']
            if start_page <= page_num <= end_page:
                page_text = page_data['full_text'] or ""

                # Remove section headers if they appear
                if entry.code:
                    # Remove lines that match the section code pattern
                    lines = page_text.split('\n')
                    filtered_lines = []
                    code_re = re.escape(entry.code)
                    for line in lines:
                        stripped = line.strip()
                        # Skip "9.2 Title..." (code + space + title)
                        if re.match(rf'^{code_re}\s+', stripped):
                            continue
                        # Skip standalone code line (e.g. "9.2" or "2.0" on its own line)
                        if re.match(rf'^{code_re}\s*$', stripped):
                            continue
                        filtered_lines.append(line)
                    page_text = '\n'.join(filtered_lines)

                # On the first page, trim at the next entry's code or title (whichever appears first)
                if (trim_at_code or trim_at_title_pattern) and page_num == start_page:
                    lines = page_text.split('\n')
                    keep_lines = []
                    for line in lines:
                        stripped = line.strip()
                        # Break at line that starts with next entry's code (when code is in text)
                        if trim_at_code:
                            code_re = re.escape(trim_at_code)
                            if re.match(rf'^{code_re}\s+', stripped) or re.match(rf'^{code_re}\s*$', stripped):
                                break
                        # Break at line that matches next entry's title (works when numbers are images)
                        if trim_at_title_pattern and trim_at_title_pattern.search(stripped):
                            break
                        keep_lines.append(line)
                    page_text = '\n'.join(keep_lines)

                text_content += page_text + "\n"
        
        # Get tables and images for this section
        key = entry.code or entry.title
        section_tables = section_tables_map.get(key, [])
        section_images = section_images_map.get(key, [])
        
        # Ensure we have a valid code
        # If no code, generate one from title or use a placeholder
        section_code = entry.code
        if not section_code:
            # Generate a code from title (sanitized) or use index
            # This is a fallback - ideally codes should be found in document body
            sanitized = re.sub(r'[^a-z0-9]+', '-', entry.title.lower())[:20]
            section_code = sanitized or f"entry-{len(sections)}"
        
        # Create section content
        section = SectionContent(
            code=section_code,
            title=entry.title,
            label=f"{section_code} {entry.title}" if section_code != entry.title else entry.title,
            level=entry.level,
            parent_code=entry.parent_code,
            start_page=start_page,
            end_page=end_page,
            text_content=text_content.strip(),
            tables=section_tables,
            images=section_images,
        )
        sections.append(section)
    
    print(f"  ✓ Extracted content for {len(sections)} sections/subsections")
    return sections, dict(section_tables_map), dict(section_images_map)


def convert_to_lexical_json(text: str) -> Dict[str, Any]:
    """
    Convert plain text to Lexical editor JSON format.
    """
    if not text or not text.strip():
        return {
            "root": {
                "type": "root",
                "format": "",
                "indent": 0,
                "version": 1,
                "direction": None,
                "children": [
                    {
                        "type": "paragraph",
                        "format": "",
                        "indent": 0,
                        "version": 1,
                        "children": [
                            {
                                "type": "text",
                                "detail": 0,
                                "format": 0,
                                "mode": "normal",
                                "style": "",
                                "text": "",
                                "version": 1,
                            }
                        ],
                    }
                ],
            }
        }
    
    # Split into paragraphs
    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
    
    if not paragraphs:
        paragraphs = [text.strip()]
    
    children = []
    for para in paragraphs:
        # Split by single newlines for line breaks
        lines = [l.strip() for l in para.split('\n') if l.strip()]
        
        for line in lines:
            children.append({
                "type": "paragraph",
                "format": "",
                "indent": 0,
                "version": 1,
                "children": [
                    {
                        "type": "text",
                        "detail": 0,
                        "format": 0,
                        "mode": "normal",
                        "style": "",
                        "text": line,
                        "version": 1,
                    }
                ],
            })
    
    return {
        "root": {
            "type": "root",
            "format": "",
            "indent": 0,
            "version": 1,
            "direction": None,
            "children": children,
        }
    }


def convert_table_to_block(table_data: List[List[str]], page_num: int) -> Optional[Dict[str, Any]]:
    """
    Convert pdfplumber table to Payload TableBlock format.
    """
    if not table_data or len(table_data) == 0:
        return None
    
    rows = []
    row_id = 1
    
    for i, row in enumerate(table_data):
        if not row:
            continue
        
        cells = [str(cell).strip() if cell else '' for cell in row]
        cells = [c for c in cells if c]
        
        if not cells:
            continue
        
        is_header = i == 0
        
        table_cells = []
        for idx, cell_text in enumerate(cells):
            table_cells.append({
                "id": f"{row_id}-{idx}",
                "text": cell_text,
                "isHeader": is_header,
                "colSpan": 1,
                "className": None,
            })
        
        rows.append({
            "id": row_id,
            "cells": table_cells,
        })
        row_id += 1
    
    if not rows:
        return None
    
    return {
        "blockType": "table",
        "style": "grid",
        "rows": rows,
        "title": None,
        "titleRich": None,
    }


def convert_list_to_block(list_text: str) -> Optional[Dict[str, Any]]:
    """
    Convert list text to Payload ListBlock format.
    """
    lines = [l.strip() for l in list_text.split('\n') if l.strip()]
    if not lines:
        return None
    
    is_ordered = False
    has_ordered = False
    has_unordered = False
    
    for line in lines[:3]:
        if re.match(r'^\d+[.)]\s', line):
            has_ordered = True
        elif re.match(r'^[\-*+•]\s', line):
            has_unordered = True
        elif re.match(r'^\([a-z\d]+\)\s', line):
            has_ordered = True
    
    is_ordered = has_ordered and not has_unordered
    kind = "ordered" if is_ordered else "unordered"
    
    items = []
    for line in lines:
        text = re.sub(r'^\d+[.)]\s*', '', line)
        text = re.sub(r'^[\-*+•]\s*', '', text)
        text = re.sub(r'^\([a-z\d]+\)\s*', '', text)
        text = text.strip()
        
        if text:
            items.append({"text": text})
    
    if not items:
        return None
    
    return {
        "blockType": "list",
        "kind": kind,
        "items": items,
    }


def convert_image_to_block(relative_path: str) -> Dict[str, Any]:
    """
    Build an image content block for Payload. The upload script will resolve
    relativePath against the data dir, upload the file to Media, and set image to the Media id.
    """
    return {
        "blockType": "image",
        "image": {
            "relativePath": relative_path,
            "url": "",
        },
        "caption": None,
        "alt": None,
    }


def extract_content_blocks(
    content: str,
    tables_by_page: Dict[int, List[List[List[str]]]]
) -> List[Dict[str, Any]]:
    """
    Extract content blocks from section/subsection content.
    Detects tables, lists, and converts text to blocks.
    """
    blocks = []
    
    if not content or not content.strip():
        return blocks
    
    # Check for markdown table syntax
    table_pattern = r'(\|.+\|\n(?:\|[\s\-:]+\|\n)?(?:\|.+\|\n?)+)'
    table_matches = list(re.finditer(table_pattern, content, re.MULTILINE))
    
    # Process content, handling tables separately
    last_index = 0
    processed_parts = []
    
    for match in table_matches:
        if match.start() > last_index:
            text_before = content[last_index:match.start()].strip()
            if text_before:
                processed_parts.append(('TEXT', text_before))
        
        processed_parts.append(('TABLE', match.group(0)))
        last_index = match.end()
    
    if last_index < len(content):
        remaining_text = content[last_index:].strip()
        if remaining_text:
            processed_parts.append(('TEXT', remaining_text))
    
    if not processed_parts:
        processed_parts.append(('TEXT', content))
    
    # Process each part
    for part_type, part_content in processed_parts:
        if part_type == 'TABLE':
            lines = [l.strip() for l in part_content.split('\n') if l.strip() and '|' in l]
            if len(lines) >= 2:
                table_rows = []
                for line in lines:
                    if re.match(r'^\|[\s\-:]+\|$', line):
                        continue
                    cells = [c.strip() for c in line.split('|') if c.strip()]
                    if cells:
                        table_rows.append(cells)
                
                if table_rows:
                    table_block = convert_table_to_block(table_rows, 0)
                    if table_block:
                        blocks.append(table_block)
                        continue
        
        # Check if it's a list
        lines = [l.strip() for l in part_content.split('\n') if l.strip()]
        if lines and len(lines) >= 2:
            is_list = all(
                re.match(r'^[\d\-*+•]\s', l) or re.match(r'^\([a-z\d]+\)\s', l)
                for l in lines[:min(5, len(lines))]
            )
            
            if is_list:
                list_block = convert_list_to_block(part_content)
                if list_block:
                    blocks.append(list_block)
                    continue
        
        # Default to rich text
        lexical_json = convert_to_lexical_json(part_content)
        if lexical_json['root']['children']:
            blocks.append({
                "blockType": "richText",
                "body": lexical_json,
            })
    
    # If no blocks created, create default rich text block
    if not blocks and content.strip():
        lexical_json = convert_to_lexical_json(content)
        if lexical_json['root']['children']:
            blocks.append({
                "blockType": "richText",
                "body": lexical_json,
            })
    
    return blocks


def generate_slug(code: str, title: Optional[str] = None) -> str:
    """
    Generate URL-friendly slug from code and title.
    """
    base = re.sub(r'[^a-z0-9]+', '-', code.lower()).strip('-')
    
    if title:
        title_slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
        title_slug = title_slug[:50]
        base = f"{base}-{title_slug}"
    
    return f"section-{base}"


def generate_sort_key(code: str) -> str:
    """
    Generate sortable key from section code.
    """
    parts = code.split('.')
    sort_parts = []
    
    for part in parts:
        try:
            num = int(part)
            sort_parts.append(f"{num:04d}")
        except ValueError:
            sort_parts.append(part)
    
    return '.'.join(sort_parts)


def validate_content_blocks(blocks: List[Dict[str, Any]]) -> Tuple[List[str], bool]:
    """
    Validate content blocks are properly formatted.
    Returns (warnings, is_valid)
    """
    warnings = []
    is_valid = True
    
    for i, block in enumerate(blocks):
        if not isinstance(block, dict):
            warnings.append(f"Block {i} is not a dictionary")
            is_valid = False
            continue
        
        if 'blockType' not in block:
            warnings.append(f"Block {i} missing blockType")
            is_valid = False
            continue
        
        block_type = block.get('blockType')
        
        if block_type == 'richText':
            if 'body' not in block or 'root' not in block.get('body', {}):
                warnings.append(f"RichText block {i} missing body/root")
                is_valid = False
        elif block_type == 'table':
            if 'rows' not in block or not isinstance(block.get('rows'), list):
                warnings.append(f"Table block {i} missing or invalid rows")
                is_valid = False
        elif block_type == 'list':
            if 'items' not in block or not isinstance(block.get('items'), list):
                warnings.append(f"List block {i} missing or invalid items")
                is_valid = False
        elif block_type == 'image':
            image_obj = block.get('image')
            if not image_obj or not isinstance(image_obj, dict):
                warnings.append(f"Image block {i} missing or invalid image object")
                is_valid = False
            elif not image_obj.get('relativePath') and not image_obj.get('id'):
                warnings.append(f"Image block {i} missing relativePath (extract) or id (upload)")
                is_valid = False
    
    return warnings, is_valid


def extract_bylaw_data(output_dir: Optional[Path] = None) -> ExtractedData:
    """
    Main extraction function using TOC-based approach.
    If output_dir is provided, images are saved there; otherwise OUTPUT_DIR is used.
    """
    print("Starting PDF extraction (TOC-based)...")
    print(f"PDF: {PDF_PATH}")
    
    resolved_output_dir = Path(output_dir) if output_dir is not None else OUTPUT_DIR
    if not resolved_output_dir.is_absolute():
        resolved_output_dir = SCRIPT_DIR.parent / resolved_output_dir
    
    # Step 1: Extract text and tables (this opens and closes the PDF)
    extracted_data = extract_text_and_tables(PDF_PATH)
    text_data = extracted_data['text_data']
    all_tables = extracted_data['tables']
    
    # Step 2: Extract table of contents (need to open PDF again)
    with pdfplumber.open(PDF_PATH) as pdf:
        toc_entries = extract_table_of_contents(pdf, max_toc_pages=15)
        
        if not toc_entries:
            raise ValueError("Could not extract table of contents. PDF structure may be different.")
        
        # Step 3: Map TOC entries to actual PDF pages
        toc_entries = map_toc_to_pages(toc_entries, pdf, text_data)
    
    # Step 4: Build section hierarchy
    toc_entries = build_section_hierarchy(toc_entries)
    
    # Step 4b: Try to find better titles for inferred major sections by searching document body
    for entry in toc_entries:
        if entry.level == 0 and entry.code and entry.title.startswith("Section "):
            # Search for pattern like "1. Legal and Interpretation" in document
            code = entry.code
            # Look for patterns: "1. Title" or "1 Title" on a line by itself
            pattern = rf'^{re.escape(code)}\s*\.?\s+([A-Z][^.\n]{10,50}?)(?:\s|$)'
            for page_data in text_data:
                matches = re.findall(pattern, page_data['full_text'], re.MULTILINE)
                if matches:
                    # Use the first match as the title
                    better_title = matches[0].strip()
                    # Clean up the title
                    better_title = re.sub(r'[.\s]+$', '', better_title)
                    if len(better_title) > 5:  # Only use if it's a reasonable length
                        entry.title = better_title
                        break
    
    # Step 4c: Extract images and save to output_dir/images/
    all_images = extract_and_save_images(PDF_PATH, resolved_output_dir)
    
    # Step 5: Extract sections and content from TOC (no need for PDF object here)
    with pdfplumber.open(PDF_PATH) as pdf:
        sections_content, section_tables_map, _ = extract_sections_from_toc(
            toc_entries, pdf, text_data, all_tables, all_images=all_images
        )
        
        # Step 6: Convert to output format
        # Categorize based on code structure:
        # - Single digit (1, 2, 3) → bylaws (major sections)
        # - Double digit (1.1, 2.0, 2.1, 2.4) → bylawSections  
        # - Triple digit (2.0.1, 2.4.1, 2.4.2) → bylawSubsections
        bylaws_output = []
        sections_output = []
        subsections_output = []
        
        # Track subsection counts per parent for sort order
        subsection_counts = defaultdict(int)
        
        # Track seen bylaw codes to avoid duplicates (only one bylaw per major section code)
        seen_bylaw_codes = set()
        
        # Extract bylaw metadata for major sections
        first_page_text = text_data[0]['full_text'] if text_data else ''
        jurisdiction_match = re.search(r'City of (\w+)', first_page_text, re.IGNORECASE)
        jurisdiction = jurisdiction_match.group(1) if jurisdiction_match else "Airdrie"
        
        for section in sections_content:
            # Extract content blocks
            content_blocks = extract_content_blocks(section.text_content, {})
            
            # Add tables as table blocks
            for table in section.tables:
                table_block = convert_table_to_block(table, section.start_page)
                if table_block:
                    content_blocks.append(table_block)
            
            # Add images as image blocks (already sorted by page, index_on_page)
            for img in section.images:
                rel_path = img.get("path")
                if rel_path:
                    content_blocks.append(convert_image_to_block(rel_path))
            
            # Determine if this is a bylaw, section, or subsection based on code structure
            code_level = determine_code_level(section.code)
            
            if code_level == 0:
                # Single digit (1, 2, 3) → bylaw (major section)
                # Only create one bylaw per code (deduplicate)
                if section.code not in seen_bylaw_codes:
                    bylaw_output = Bylaw(
                        code=section.code,
                        title=section.title or f"Section {section.code}",
                        jurisdiction=jurisdiction,
                        effectiveDate=None,
                        sortKey=generate_sort_key(section.code),
                    )
                    bylaws_output.append(bylaw_output)
                    seen_bylaw_codes.add(section.code)
            elif code_level == 1:
                # Double digit (1.1, 2.0, 2.1, 2.4) → bylawSection
                section_output = BylawSection(
                    code=section.code,
                    title=section.title,
                    label=section.label,
                    slug=generate_slug(section.code, section.title),
                    sortKey=generate_sort_key(section.code),
                    content=content_blocks,
                )
                sections_output.append(section_output)
            else:
                # Triple digit or more (2+) → bylawSubsection
                # Calculate sort order based on parent
                parent_key = (section.parent_code or '', code_level)
                subsection_counts[parent_key] += 1
                sort_order = subsection_counts[parent_key]
                
                subsection_output = BylawSubsection(
                    code=section.code,
                    level=code_level,
                    title=section.title,
                    label=section.label,
                    slug=generate_slug(section.code, section.title),
                    sortOrder=sort_order,
                    content=content_blocks,
                )
                subsections_output.append(subsection_output)
        
        # Validate content blocks
        print("Validating content blocks...")
        all_block_warnings = []
        for section in sections_output:
            block_warnings, is_valid = validate_content_blocks(section.content)
            if block_warnings:
                all_block_warnings.extend([f"Section {section.code}: {w}" for w in block_warnings])
        
        for subsection in subsections_output:
            block_warnings, is_valid = validate_content_blocks(subsection.content)
            if block_warnings:
                all_block_warnings.extend([f"Subsection {subsection.code}: {w}" for w in block_warnings])
        
        if all_block_warnings:
            print(f"   ⚠ Found {len(all_block_warnings)} content block warnings (first 5 shown)")
            for warning in all_block_warnings[:5]:
                print(f"      {warning}")
        else:
            print("   ✓ All content blocks validated")
        
        print(f"✓ Extracted {len(bylaws_output)} bylaws, {len(sections_output)} sections and {len(subsections_output)} subsections")
    
    return ExtractedData(
        bylaws=bylaws_output,
        sections=sections_output,
        subsections=subsections_output,
    )


def extract_bylaw_by_page_range(config: Dict[str, Any]) -> ExtractedData:
    """
    Extract one bylaw by page range using a provided TOC config.
    Config keys: pdfPath, pageRange { start, end }, bylaw { code, title }, sections [], subsections [].
    """
    pdf_path = Path(config["pdfPath"])
    if not pdf_path.is_absolute():
        pdf_path = SCRIPT_DIR.parent / pdf_path
    page_range = config["pageRange"]
    start_page = int(page_range["start"])
    end_page = int(page_range["end"])
    bylaw_config = config["bylaw"]
    bylaw_code = bylaw_config["code"]
    bylaw_title = bylaw_config["title"]
    sections_config = config.get("sections", [])
    subsections_config = config.get("subsections", [])

    print("Starting page-range extraction (config TOC)...")
    print(f"  PDF: {pdf_path}")
    print(f"  Pages: {start_page}-{end_page}")
    print(f"  Bylaw: {bylaw_code} {bylaw_title}")

    extracted = extract_text_and_tables(pdf_path, start_page=start_page, end_page=end_page)
    text_data = extracted["text_data"]
    all_tables = extracted["tables"]

    toc_entries = build_toc_entries_from_config(
        bylaw_code, bylaw_title, sections_config, subsections_config
    )
    map_config_toc_to_pages(toc_entries, text_data, last_page_in_range=end_page)

    output_dir = config.get("outputDir") or "extracted-bylaw-data"
    resolved_output_dir = Path(output_dir)
    if not resolved_output_dir.is_absolute():
        resolved_output_dir = SCRIPT_DIR.parent / resolved_output_dir

    all_images = extract_and_save_images(
        pdf_path, resolved_output_dir, start_page=start_page, end_page=end_page
    )

    with pdfplumber.open(pdf_path) as pdf:
        sections_content, _, _ = extract_sections_from_toc(
            toc_entries, pdf, text_data, all_tables, all_images=all_images
        )

    jurisdiction = "Airdrie"
    if text_data:
        first_text = text_data[0].get("full_text") or ""
        jur_match = re.search(r"City of (\w+)", first_text, re.IGNORECASE)
        if jur_match:
            jurisdiction = jur_match.group(1)

    bylaws_output = [
        Bylaw(
            code=bylaw_code,
            title=bylaw_title,
            jurisdiction=jurisdiction,
            effectiveDate=None,
            sortKey=generate_sort_key(bylaw_code),
        )
    ]
    sections_output = []
    subsections_output = []
    subsection_counts = defaultdict(int)

    for section in sections_content:
        content_blocks = extract_content_blocks(section.text_content, {})
        for table in section.tables:
            table_block = convert_table_to_block(table, section.start_page)
            if table_block:
                content_blocks.append(table_block)
        for img in section.images:
            rel_path = img.get("path")
            if rel_path:
                content_blocks.append(convert_image_to_block(rel_path))

        code_level = determine_code_level(section.code)
        if code_level == 1:
            sections_output.append(
                BylawSection(
                    code=section.code,
                    title=section.title,
                    label=section.label,
                    slug=generate_slug(section.code, section.title),
                    sortKey=generate_sort_key(section.code),
                    content=content_blocks,
                )
            )
        elif code_level >= 2:
            parent_key = (section.parent_code or "", code_level)
            subsection_counts[parent_key] += 1
            subsections_output.append(
                BylawSubsection(
                    code=section.code,
                    level=code_level,
                    title=section.title,
                    label=section.label,
                    slug=generate_slug(section.code, section.title),
                    sortOrder=subsection_counts[parent_key],
                    content=content_blocks,
                )
            )

    print("Validating content blocks...")
    for s in sections_output:
        block_warnings, _ = validate_content_blocks(s.content)
        if block_warnings:
            for w in block_warnings[:3]:
                print(f"   Section {s.code}: {w}")
    for s in subsections_output:
        block_warnings, _ = validate_content_blocks(s.content)
        if block_warnings:
            for w in block_warnings[:3]:
                print(f"   Subsection {s.code}: {w}")
    print(f"✓ Extracted 1 bylaw, {len(sections_output)} sections, {len(subsections_output)} subsections")

    return ExtractedData(
        bylaws=bylaws_output,
        sections=sections_output,
        subsections=subsections_output,
    )


def save_extracted_data(data: ExtractedData, output_dir: Optional[Path] = None):
    """
    Save extracted data to JSON files.
    If output_dir is provided, write to that directory (resolved relative to project root);
    otherwise use default OUTPUT_DIR.
    """
    out = output_dir
    if out is not None:
        out = Path(out)
        if not out.is_absolute():
            out = SCRIPT_DIR.parent / out
    else:
        out = OUTPUT_DIR
    out.mkdir(parents=True, exist_ok=True)

    bylaws_dict = [asdict(b) for b in data.bylaws]
    sections_dict = [asdict(s) for s in data.sections]
    subsections_dict = [asdict(s) for s in data.subsections]
    
    # Sections need to reference their parent bylaw (major section)
    sections_with_placeholders = []
    for s in sections_dict:
        # Find parent bylaw code (first part of section code, e.g., "2.0" -> "2")
        section_code = s.get('code', '')
        parent_bylaw_code = section_code.split('.')[0] if '.' in section_code else None
        section_with_placeholder = {**s, "bylaw": f"<BYLAW_ID_{parent_bylaw_code}>"}
        sections_with_placeholders.append(section_with_placeholder)
    
    subsections_with_placeholders = []
    for s in subsections_dict:
        subsection = {**s, "section": "<SECTION_ID>"}
        if s.get('code', '').count('.') > 2:
            subsection["parentSubsection"] = "<PARENT_SUBSECTION_ID>"
        subsections_with_placeholders.append(subsection)
    
    complete_data = {
        "bylaws": bylaws_dict,
        "sections": sections_dict,
        "subsections": subsections_dict,
        "_notes": {
            "bylaws": "Major sections (single digits like 1, 2, 3). Create these first.",
            "sections": "Sections (double digits like 1.1, 2.0, 2.1). Each needs a 'bylaw' field set to the parent bylaw ID.",
            "subsections": "Subsections (triple digits like 2.0.1, 2.4.1). Each needs a 'section' field set to the parent section ID.",
            "relationships": "Relationship IDs (bylaw, section, parentSubsection) should be set during import using the Local API.",
        },
    }
    
    with open(out / "bylaw-data.json", "w", encoding="utf-8") as f:
        json.dump(complete_data, f, indent=2, ensure_ascii=False)

    with open(out / "bylaws.json", "w", encoding="utf-8") as f:
        json.dump(bylaws_dict, f, indent=2, ensure_ascii=False)

    with open(out / "bylaw-sections.json", "w", encoding="utf-8") as f:
        json.dump(sections_with_placeholders, f, indent=2, ensure_ascii=False)

    with open(out / "bylaw-subsections.json", "w", encoding="utf-8") as f:
        json.dump(subsections_with_placeholders, f, indent=2, ensure_ascii=False)
    
    total_blocks = sum(len(s.content) for s in data.sections) + sum(len(s.content) for s in data.subsections)
    readme = f"""# Extracted Bylaw Data

This directory contains extracted data from the Land Use Bylaw PDF, formatted for Payload CMS import.

## Files

- `bylaw-data.json` - Complete extracted data with all bylaws, sections and subsections
- `bylaws.json` - Major sections (single digits like 1, 2, 3) as bylaw documents
- `bylaw-sections.json` - Sections (double digits like 1.1, 2.0, 2.1) with relationship placeholders
- `bylaw-subsections.json` - Subsections (triple digits like 2.0.1, 2.4.1) with relationship placeholders

## Import Process

### Option 1: Use the Upload Script (Recommended)

```bash
npm run upload:bylaw
```

### Option 2: Manual Import

See README for manual import instructions.

## Statistics

- Bylaws (major sections): {len(data.bylaws)} documents
- Sections: {len(data.sections)}
- Subsections: {len(data.subsections)}
- Total content blocks: {total_blocks}

## Notes

- Relationship IDs (`bylaw`, `section`, `parentSubsection`) are placeholders and must be replaced with actual IDs during import
- Content blocks are already formatted in Payload CMS block format (RichTextBlock, TableBlock, ListBlock)
- Slugs are auto-generated from section codes and titles
- Sort keys are generated for proper ordering
"""
    
    with open(out / "README.md", "w", encoding="utf-8") as f:
        f.write(readme)

    print(f"\n✅ Extraction complete! Files saved to: {out}")
    print(f"   - bylaw-data.json (complete data)")
    print(f"   - bylaws.json ({len(data.bylaws)} bylaws)")
    print(f"   - bylaw-sections.json ({len(data.sections)} sections)")
    print(f"   - bylaw-subsections.json ({len(data.subsections)} subsections)")
    print(f"   - README.md (import instructions)")


def main():
    """Main execution function."""
    try:
        print("PDF to Payload CMS Extractor (Python - Systematic)")
        print("=" * 50)
        print()

        config_path = None
        if "--config" in sys.argv:
            idx = sys.argv.index("--config")
            if idx + 1 < len(sys.argv):
                config_path = Path(sys.argv[idx + 1])
            else:
                print("Error: --config requires a path to a JSON config file.")
                sys.exit(1)

        if config_path is not None:
            config_path = Path(config_path)
            if not config_path.is_absolute():
                # Resolve relative to project root so "scripts/bylaw-2-extract-config.json" works
                config_path = SCRIPT_DIR.parent / config_path
            if not config_path.exists():
                print(f"Error: Config file not found: {config_path}")
                sys.exit(1)
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
            data = extract_bylaw_by_page_range(config)
            output_dir = config.get("outputDir")
        else:
            data = extract_bylaw_data()
            output_dir = None

        save_extracted_data(data, output_dir=output_dir)

        print("\n📝 Next steps:")
        print("   1. Review the extracted JSON files")
        print("   2. Run 'npm run clear:bylaw' to clear existing data (if needed)")
        print("   3. Run 'npm run upload:bylaw' to upload the data")
        print("\n✅ Extraction completed successfully!")

    except Exception as e:
        print(f"\n❌ Extraction failed!")
        print(f"Error: {str(e)}")
        import traceback
        if "--debug" in sys.argv:
            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
