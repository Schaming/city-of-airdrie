# Definition Import Scripts

This directory contains scripts to import zoning bylaw definitions from CSV files into the Payload CMS database.

## Overview

The import process has two steps:
1. **Convert CSV to JSON** (`convert.js`)
2. **Import JSON into Database** (`importDefinitions.js`)

## Prerequisites

- Node.js environment with ES modules support
- Payload CMS running with the following collections configured:
  - `definitions` - Stores definition terms and aliases
  - `definition-content` - Stores the actual definition text content
- Environment variables set up:
  - `DATABASE_URL`
  - `PAYLOAD_SECRET`

## Step 1: Convert CSV to JSON

### CSV File Format

Your CSV file should have the following columns:

| Column | Description | Required |
|--------|-------------|----------|
| `termID` | Unique identifier for the definition (e.g., "DEF001") | Yes |
| `terms` | Semicolon-separated list of terms/aliases (e.g., "accessory building;accessory structure") | Yes |
| `text` | The definition text content | Yes |
| `type` | Definition category (e.g., "General", "Technical") | Optional (defaults to "General") |
| `image` | Image reference (reserved for future use) | Optional |

**Example CSV:**
```csv
termID,terms,text,type,image
DEF001,accessory building;accessory structure,A subordinate building detached from the principal building on the same lot.,Building,
DEF002,dwelling unit,A room or suite of rooms used as a domicile by one or more persons.,Residential,
```

### Running the Conversion

1. Place your CSV file in this directory (e.g., `definitions test2.csv`)

2. Update the file paths in `convert.js`:
   ```javascript
   const filePath = './definitions test2.csv';  // Your input CSV file
   const outputFile = './definitions2.json';    // Your output JSON file
   ```

3. Run the script:
   ```bash
   node convert.js
   ```

4. The script will:
   - Read the CSV file
   - Filter out completely blank rows
   - Output a formatted JSON file

**Output:** You'll get a `definitions2.json` file ready for import.

## Step 2: Import into Database

### What the Import Does

The `importDefinitions.js` script:

1. **Creates or updates DefinitionContent entries** - Each unique `termID` gets one content entry
2. **Auto-links terms** - Automatically adds clickable links when one definition references another term
3. **Creates Definition entries** - Each term/alias in the `terms` column becomes a separate definition pointing to the shared content
4. **Prevents duplicates** - Checks existing data and only creates new entries

### Running the Import

1. Ensure your environment variables are set in `.env`:
   ```bash
   DATABASE_URL=your_database_url
   PAYLOAD_SECRET=your_payload_secret
   ```

2. Make sure the JSON file path is correct in `importDefinitions.js`:
   ```javascript
   const dataPath = path.resolve(__dirname, './definitions2.json');
   ```

3. Run the import:
   ```bash
   node importDefinitions.js
   ```

### Import Process Details

The script executes in this order:

1. **Fetches existing data** to prevent duplicates
2. **Processes each definition**:
   - Scans the text for references to other terms
   - Wraps found terms with `<span class="def-link" data-id="...">` tags for cross-linking
   - Creates or updates the `DefinitionContent` entry
3. **Creates definition aliases**:
   - Each term in the `terms` field becomes a separate `Definition` entry
   - All aliases point to the same `DefinitionContent`
4. **Logs progress** for each action taken

### Console Output

You'll see messages like:
```
Created DefinitionContent: DEF001
Created Definition: accessory building
Created Definition: accessory structure
Skipped existing Definition term: dwelling unit
Successfully linked a term in: DEF005
Import finished!
```

## Complete Workflow Example

```bash
# 1. Place your CSV file in this directory
cp ~/Downloads/definitions.csv ./definitions.csv

# 2. Update convert.js to use your file name
# Edit: const filePath = './definitions.csv';

# 3. Convert CSV to JSON
node convert.js
# Output: JSON file created at ./definitions2.json

# 4. Make sure your environment is set up
cat ../../.env  # Check DATABASE_URL and PAYLOAD_SECRET exist

# 5. Import into database
node importDefinitions.js
# Output: Created DefinitionContent: DEF001... etc.
```

## Troubleshooting

### "Database URL env var is not set"
- Make sure your `.env` file exists in the project root
- Check that `DATABASE_URL` is defined in `.env`

### "PAYLOAD_SECRET is not set"
- Add `PAYLOAD_SECRET=your_secret_key` to your `.env` file

### "Cannot find module '@payload-config'"
- Run the script with **tsx** (not plain `node`) so the `@payload-config` path alias is resolved. From the project root: `pnpm run import:definitions` or `pnpm exec tsx scripts/definitions/importDefinitions.js`
- Ensure all dependencies are installed: `pnpm install`

### Duplicate imports
- The script is idempotent - running it multiple times won't create duplicates
- Existing definitions are skipped automatically

## Cross-Linking Feature

The auto-linking feature scans each definition's text and automatically creates clickable links to other definitions. For example:

**Input text:**
```
A dwelling unit with a separate accessory building on the same lot.
```

**Processed text:**
```
A <span class="def-link" data-id="DEF002">dwelling unit</span> with a separate 
<span class="def-link" data-id="DEF001">accessory building</span> on the same lot.
```

This enables rich, interconnected definition lookups in your application.

## Notes

- The scripts use ES module syntax (`import`/`export`)
- Long terms are matched first to prevent partial matches
- Only whole-word matches are linked (uses `\b` regex boundaries)
- Already-tagged terms are not re-tagged (prevents nested spans)
- The import runs with `overrideAccess: true` to bypass Payload's access control during bulk operations
