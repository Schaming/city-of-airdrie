# Deployment Documentation & Technical Debt Registry
**Date:** January 14, 2026
**Project:** Zoning Bylaw (Next.js + Payload CMS + PostgreSQL + Docker)

---

## Part 1: Deployment & Infrastructure Summary
This section summarizes the changes made to successfully containerize and deploy the application.

### 1. Docker & Build Process
- **Base Image:** Switched from `alpine` to `node:22.17.0-slim` (Debian-based).
- **Dependency Resolution:** Added `--legacy-peer-deps` to the `npm ci` command to resolve version conflicts between Payload CMS and React 19.
- **Build-Time Variables:** Configured the `Dockerfile` with `ARG` and `ENV` for `NEXT_PUBLIC_SERVER_URL` and `NEXT_PUBLIC_SITE_URL`. These must be available during `next build` to be baked into the client-side JavaScript.
- **Standalone Mode:** Enabled `output: 'standalone'` in `next.config.js` for a minimal production container.

### 2. Payload CMS Configuration
- **Package Sync:** All `@payloadcms/*` packages synchronized to version `3.71.1`.
- **Security:** 
    - Explicitly set `serverURL`.
    - Configured `csrf` and `cors` whitelists.
    - Moved `auth` cookie configuration into the `Users` collection (Payload 3.0 requirement) and enabled `secure: true`.
- **Storage:** Migrated from `@payloadcms/plugin-cloud-storage` to the modern `@payloadcms/storage-s3` for Supabase compatibility (if used).

### 3. Database
- **PostgreSQL:** Migrated from SQLite to PostgreSQL.
- **Build Resilience:** Wrapped `payload.find` calls in frontend pages in `try/catch` blocks so that missing database tables during the build phase don't crash the entire deployment.

---

## Part 2: Technical Debt & Hard-Code Registry
These are the specific workarounds and hard-coded values that should be refactored for better reusability in the future.

### 1. Hard-Coded Domains
*   **File:** `next.config.js`
    *   **Hard-code:** `hostname: 'denqgjkbvtaecqkbixjj.storage.supabase.co'`
    *   **Why:** Next.js Image Optimization needs the storage domain at build time. Intermittent environment variable propagation issues made it safer to hard-code this for the initial launch.
    *   **Refactor:** Transition back to using only the `PUBLIC_ASSET_BASE_URL` variable.
*   **File:** `src/payload.config.ts`
    *   **Hard-code:** `https://zoningbylaw-airdrie-211379656884.us-central1.run.app` in `cors` and `csrf` arrays.
    *   **Why:** To ensure immediate permission for browser-side `PATCH`/`POST` requests when `serverURL` variables were unstable.
    *   **Refactor:** Implement a single `ALLOWED_ORIGINS` variable.

### 2. Build-Time "Dummy" Variables
*   **File:** `Dockerfile`
    *   **Workaround:** `export DATABASE_URL="postgresql://build:build@localhost:1/build"` (dummy) and dummy secrets so the build does not need a real DB.
    *   **Why:** Payload initializes during build. Without a database string, it crashes. We used a local SQLite file to "satisfy" the build.
    *   **Refactor:** Use a dedicated `.env.build` or a Payload "Build Mode" flag.
*   **File:** `src/payload.config.ts`
    *   **Workaround:** `secret: process.env.PAYLOAD_SECRET || 'TEMP_SECRET_FOR_BUILDING_ONLY'`
    *   **Why:** Prevents app crashes if the runtime secret isn't provided during the build phase.

### 3. Error Silencing (The "Try/Catch" Workaround)
*   **File:** `src/app/(frontend)/[slug]/page.tsx` (and other frontend routes)
    *   **Workaround:** `try { ... } catch { return [] }` around data fetches.
    *   **Why:** Prerendering tries to fetch data before the tables might be ready or connected in the build environment.
    *   **Refactor:** Use a `BUILD_PHASE` flag to skip fetching instead of catching errors silently.

### 4. Type Casting
*   **Workaround:** `doc as unknown as BylawSection` and `id: string | number`.
    *   **Why:** Payload uses `number` IDs for collections but `string` (UUIDs) for blocks. This causes frequent TypeScript mismatches in the UI.
    *   **Refactor:** Define a project-wide `PayloadID` type.

---

## Future Cleanup Priorities
1. **Unify Environment Variables:** Ensure build and runtime environments use the same source of truth.
2. **Refactor Image Whitelisting:** Move the Supabase domain back into a variable.
3. **ID Constraint Check:** Investigate the `UNIQUE constraint failed` error in `bylaw_subsections_blocks_table_rows` to ensure import scripts aren't generating duplicate IDs.
