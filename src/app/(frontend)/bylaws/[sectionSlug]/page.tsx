import { notFound } from 'next/navigation';
import { BlocksRenderer } from '../../components/BlocksRender';
import { SubsectionSidebar } from '../../components/SubsectionSidebar';
import configPromise from '@payload-config';
import { getPayload } from 'payload';
import { type BylawSection, type BylawSubsection } from '../../components/AllBylawsView';
import '../bylaws.css';

type SectionPageData = {
  section: BylawSection;
  subsections: BylawSubsection[];
};

export const dynamic = 'force-dynamic';

async function getSectionPageData(sectionSlug: string): Promise<SectionPageData | null> {
  try {
    const payload = await getPayload({ config: configPromise });

    // 1) get section
    const result = await payload.find({
      collection: 'bylawSections',
      where: {
        slug: {
          equals: sectionSlug,
        },
      },
      limit: 1,
    });

    const sectionDoc = result.docs?.[0] as unknown as (BylawSection) | undefined;

    if (!sectionDoc) return null;

    // 2) get subsections
    const subsResult = await payload.find({
      collection: 'bylawSubsections',
      where: {
        section: {
          equals: sectionDoc.id,
        },
      },
      sort: '-sortOrder',
      limit: 500,
    });

    const subsections = (subsResult.docs as unknown as BylawSubsection[]).sort((a, b) => {
      const aOrder = a.sortOrder ?? Number.NEGATIVE_INFINITY;
      const bOrder = b.sortOrder ?? Number.NEGATIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder; // higher sortOrder first

      // Fallback to code (descending) to keep order predictable
      return (b.code || '').localeCompare(a.code || '', undefined, { numeric: true });
    });

    return {
      section: {
        id: sectionDoc.id,
        code: sectionDoc.code,
        label: sectionDoc.label,
        title: sectionDoc.title,
        slug: sectionDoc.slug,
      },
      subsections,
    };
  } catch (error) {
    console.error('Failed to fetch section page data during build', error);
    return null;
  }
}

// 🔥 dynamic params are a Promise now
type SectionPageProps = {
  params: Promise<{ sectionSlug: string }>;
};

export default async function SectionPage({ params }: SectionPageProps) {
  const { sectionSlug } = await params;

  const data = await getSectionPageData(sectionSlug);
  if (!data) return notFound();

  const { section, subsections } = data;
  const navSubsections = subsections.map(({ id, slug, code, title, level }) => ({
    id,
    slug,
    code,
    title,
    level,
  }));

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4">
      <header className="mb-8">
        <h1>{section.label}</h1>
      </header>

      <div className="flex flex-col lg:flex-row gap-12">
        <div className="lg:w-64 lg:shrink-0 lg:sticky lg:top-4 self-start">
          <nav className="text-sm border-r pr-4">
            <SubsectionSidebar subsections={navSubsections} />
          </nav>
        </div>

        <section className="flex-1 space-y-12">
          {subsections.map(sub => (
            <article
              key={sub.id}
              id={sub.slug}
              className={sub.level && sub.level > 1 ? 'ml-6 border-l pl-4' : ''}
            >
              <h2>
                {sub.code} {sub.title}
              </h2>

              <BlocksRenderer blocks={sub.content ?? []} />
            </article>
          ))}
        </section>

        <aside className="hidden lg:block lg:pl-4">
          {/* Reserved space for future right-rail content */}
        </aside>
      </div>
    </div>
  );
}
