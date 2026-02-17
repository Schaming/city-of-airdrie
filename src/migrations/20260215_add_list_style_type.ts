import { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-postgres';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(`
    ALTER TABLE "bylaw_sections_blocks_list"
    ADD COLUMN IF NOT EXISTS "list_style_type" varchar DEFAULT 'decimal';
  `);
  await db.execute(`
    ALTER TABLE "_bylaw_sections_v_blocks_list"
    ADD COLUMN IF NOT EXISTS "list_style_type" varchar DEFAULT 'decimal';
  `);
  await db.execute(`
    ALTER TABLE "bylaw_subsections_blocks_list"
    ADD COLUMN IF NOT EXISTS "list_style_type" varchar DEFAULT 'decimal';
  `);
  await db.execute(`
    ALTER TABLE "_bylaw_subsections_v_blocks_list"
    ADD COLUMN IF NOT EXISTS "list_style_type" varchar DEFAULT 'decimal';
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(`
    ALTER TABLE "bylaw_sections_blocks_list"
    DROP COLUMN IF EXISTS "list_style_type";
  `);
  await db.execute(`
    ALTER TABLE "_bylaw_sections_v_blocks_list"
    DROP COLUMN IF EXISTS "list_style_type";
  `);
  await db.execute(`
    ALTER TABLE "bylaw_subsections_blocks_list"
    DROP COLUMN IF EXISTS "list_style_type";
  `);
  await db.execute(`
    ALTER TABLE "_bylaw_subsections_v_blocks_list"
    DROP COLUMN IF EXISTS "list_style_type";
  `);
}
