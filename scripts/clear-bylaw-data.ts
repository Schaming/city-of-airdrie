// scripts/clear-bylaw-data.ts
// Safely clears all bylaw-related data from the database
import 'dotenv/config';
import config from '@payload-config';
import { getPayload, Payload } from 'payload';

/**
 * Clear all bylaw-related data from database
 */
async function clearBylawData() {
  const dbUrl =
    process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
  if (!dbUrl) {
    throw new Error(
      'Database URL env var is not set. Set DATABASE_URL in .env (see payload.config.ts).',
    );
  }

  if (!process.env.PAYLOAD_SECRET) {
    throw new Error('PAYLOAD_SECRET is not set. Add it to .env or pass it via the environment.');
  }

  console.log('Initializing Payload CMS...');
  const payload = await getPayload({ config });

  console.log('Clearing bylaw data...');
  console.log('⚠️  This will delete ALL bylaw-related data:');
  console.log('   - All bylaw subsections');
  console.log('   - All bylaw sections');
  console.log('   - All bylaw documents');
  console.log('   - Other collections (users, definitions, etc.) will be preserved\n');

  let deletedCount = 0;

  // Delete subsections first (due to foreign key constraints)
  console.log('1. Deleting bylaw subsections...');
  try {
    const subsections = await payload.find({
      collection: 'bylawSubsections',
      limit: 1000,
      overrideAccess: true,
    });

    for (const subsection of subsections.docs) {
      await payload.delete({
        collection: 'bylawSubsections',
        id: subsection.id,
        overrideAccess: true,
      });
      deletedCount++;
    }

    // Delete in batches if there are more
    let page = 2;
    while (subsections.totalPages && page <= subsections.totalPages) {
      const moreSubsections = await payload.find({
        collection: 'bylawSubsections',
        limit: 1000,
        page,
        overrideAccess: true,
      });

      for (const subsection of moreSubsections.docs) {
        await payload.delete({
          collection: 'bylawSubsections',
          id: subsection.id,
          overrideAccess: true,
        });
        deletedCount++;
      }

      if (!moreSubsections.totalPages || page >= moreSubsections.totalPages) break;
      page++;
    }

    console.log(`   ✓ Deleted ${deletedCount} subsections`);
  } catch (error: any) {
    console.error(`   ❌ Error deleting subsections: ${error.message}`);
  }

  // Delete sections
  console.log('2. Deleting bylaw sections...');
  let sectionCount = 0;
  try {
    const sections = await payload.find({
      collection: 'bylawSections',
      limit: 1000,
      overrideAccess: true,
    });

    for (const section of sections.docs) {
      await payload.delete({
        collection: 'bylawSections',
        id: section.id,
        overrideAccess: true,
      });
      sectionCount++;
    }

    // Delete in batches if there are more
    let page = 2;
    while (sections.totalPages && page <= sections.totalPages) {
      const moreSections = await payload.find({
        collection: 'bylawSections',
        limit: 1000,
        page,
        overrideAccess: true,
      });

      for (const section of moreSections.docs) {
        await payload.delete({
          collection: 'bylawSections',
          id: section.id,
          overrideAccess: true,
        });
        sectionCount++;
      }

      if (!moreSections.totalPages || page >= moreSections.totalPages) break;
      page++;
    }

    console.log(`   ✓ Deleted ${sectionCount} sections`);
  } catch (error: any) {
    console.error(`   ❌ Error deleting sections: ${error.message}`);
  }

  // Delete bylaw documents
  console.log('3. Deleting bylaw documents...');
  let bylawCount = 0;
  try {
    const bylaws = await payload.find({
      collection: 'bylaws',
      limit: 1000,
      overrideAccess: true,
    });

    for (const bylaw of bylaws.docs) {
      await payload.delete({
        collection: 'bylaws',
        id: bylaw.id,
        overrideAccess: true,
      });
      bylawCount++;
    }

    console.log(`   ✓ Deleted ${bylawCount} bylaw documents`);
  } catch (error: any) {
    console.error(`   ❌ Error deleting bylaws: ${error.message}`);
  }

  console.log(`\n✅ Cleanup complete!`);
  console.log(`   - Deleted ${deletedCount} subsections`);
  console.log(`   - Deleted ${sectionCount} sections`);
  console.log(`   - Deleted ${bylawCount} bylaw documents`);
  console.log(`\n📝 You can now run 'npm run extract:bylaw' to extract fresh data.`);
}

/**
 * Main execution
 */
async function run() {
  try {
    console.log('Bylaw Data Cleanup');
    console.log('==================\n');

    await clearBylawData();
  } catch (error: any) {
    console.error('\n❌ Cleanup failed!');
    console.error('Error:', error.message);
    if (error.stack && process.env.DEBUG) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

run();
