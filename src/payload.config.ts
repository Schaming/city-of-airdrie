import { postgresAdapter } from '@payloadcms/db-postgres';
import sharp from 'sharp';
import path from 'path';
import { buildConfig, PayloadRequest } from 'payload';
import { fileURLToPath } from 'url';

import { Categories } from './collections/Categories';
import { Media } from './collections/Media';
import { Pages } from './collections/Pages';
import { Posts } from './collections/Posts';
import { Users } from './collections/Users';
import { Footer } from './Footer/config';
import { Header } from './Header/config';
import { plugins } from './plugins';
import { defaultLexical } from '@/fields/defaultLexical';
import { getServerSideURL } from './utilities/getURL';
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs';
import type { BylawSection } from './payload-types';
import { Bylaws } from './collections/Bylaws';
import { BylawSections } from './collections/BylawSections';
import { BylawSubsections } from './collections/BylawSubsections';
import { Definitions } from './collections/Definitions';
import { DefinitionContent } from './collections/DefinitionContent';
import { Amendments } from './collections/Amendments';
import { s3Storage } from '@payloadcms/storage-s3';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const asBylawSection = (doc: Record<string, unknown>): BylawSection =>
  doc as unknown as BylawSection;

const serverURL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';

export default buildConfig({
  serverURL,
  admin: {
    components: {
      // The `BeforeLogin` component renders a message that you see while logging into your admin panel.
      // Feel free to delete this at any time. Simply remove the line below.
      beforeLogin: ['./components/BeforeLogin'],
      // Add a graphic override so the login page shows the CivicZone logo.
      graphics: {
        Logo: './components/AdminLogin',
      },
      // The `BeforeDashboard` component renders the 'welcome' block that you see after logging into your admin panel.
      // Feel free to delete this at any time. Simply remove the line below.
      beforeDashboard: ['./components/BeforeDashboard'],
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
    user: Users.slug,
    livePreview: {
      breakpoints: [
        {
          label: 'Mobile',
          name: 'mobile',
          width: 375,
          height: 667,
        },
        {
          label: 'Tablet',
          name: 'tablet',
          width: 768,
          height: 1024,
        },
        {
          label: 'Desktop',
          name: 'desktop',
          width: 1440,
          height: 900,
        },
      ],
    },
  },
  // This config helps us configure global or default features that the other editors can inherit
  editor: defaultLexical,
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || process.env.VECTOR_DATABASE_URL || '',
    },
    push: false, // Use migrations instead of auto-sync for better performance
  }),
  collections: [
    Pages,
    Posts,
    Media,
    Categories,
    Users,
    Bylaws,
    BylawSections,
    BylawSubsections,
    Definitions,
    DefinitionContent,
    Amendments,
  ],
  cors: [
    serverURL,
    getServerSideURL(),
    'https://zoningbylaw-airdrie-211379656884.us-central1.run.app',
  ].filter(Boolean),
  csrf: [
    serverURL,
    getServerSideURL(),
    'https://zoningbylaw-airdrie-211379656884.us-central1.run.app',
  ].filter(Boolean),
  globals: [Header, Footer],
  plugins: [
    ...plugins,
    nestedDocsPlugin({
      collections: ['bylawSections'],

      generateLabel: (_docs: Record<string, unknown>[], doc: Record<string, unknown>): string => {
        const s = asBylawSection(doc);
        return s.label ?? s.title ?? s.code ?? 'Untitled';
      },

      generateURL: (docs: Record<string, unknown>[]): string => {
        return docs.map(d => asBylawSection(d).slug).reduce((url, slug) => `${url}/${slug}`, '');
      },
    }),
    // Only enable S3 storage if the bucket name is provided (Live mode)
    ...(process.env.S3_BUCKET
      ? [
          s3Storage({
            collections: {
              media: {
                generateFileURL: ({ filename }: { filename: string }) =>
                  `${process.env.PUBLIC_ASSET_BASE_URL}/${filename}`,
              },
            },
            bucket: process.env.S3_BUCKET!,
            config: {
              endpoint: process.env.S3_ENDPOINT!,
              region: process.env.S3_REGION!,
              credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY_ID!,
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
              },
              forcePathStyle: true, // required for Supabase S3 API
            },
          }),
        ]
      : []),
  ],
  secret: process.env.PAYLOAD_SECRET || 'TEMP_SECRET_FOR_BUILDING_ONLY',
  sharp,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  jobs: {
    access: {
      run: ({ req }: { req: PayloadRequest }): boolean => {
        // Allow logged in users to execute this endpoint (default)
        if (req.user) return true;

        // If there is no logged in user, then check
        // for the Vercel Cron secret to be present as an
        // Authorization header:
        const authHeader = req.headers.get('authorization');
        return authHeader === `Bearer ${process.env.CRON_SECRET}`;
      },
    },
    tasks: [],
  },
});
