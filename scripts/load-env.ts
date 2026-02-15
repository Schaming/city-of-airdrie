/**
 * Load env before any other script code runs.
 * When DOTENV_CONFIG_PATH is '.env.supabase', apply hardcoded Supabase credentials below
 * (no .env file). Otherwise load from dotenv (file from DOTENV_CONFIG_PATH or .env).
 */
import dotenv from 'dotenv'

const envPath = process.env.DOTENV_CONFIG_PATH

// Hardcoded Supabase credentials when DOTENV_CONFIG_PATH is '.env.supabase'. Update if project/password changes.
export const SUPABASE_ENV: Record<string, string> = {
  DATABASE_URL:
    'postgresql://postgres.fpiwfrwqfojftyojwznw:Airdriezuza1oG@aws-1-us-east-2.pooler.supabase.com:6543/postgres',
  PAYLOAD_SECRET: 'dOP3x2QOinXrXV5y4GhZBmiL08SVI8cz8sMwH7v88',
  S3_BUCKET: 'airdrie',
  S3_ENDPOINT: 'https://fpiwfrwqfojftyojwznw.storage.supabase.co/storage/v1/s3',
  S3_REGION: 'us-east-2',
  S3_ACCESS_KEY_ID: '989eec0d15600553ad703bb5001b15de',
  S3_SECRET_ACCESS_KEY: '1141e7b0190adcb27605658df1422c8b44261a2e8d756857540598220c1619c5',
  PUBLIC_ASSET_BASE_URL:
    'https://fpiwfrwqfojftyojwznw.storage.supabase.co/storage/v1/object/public/airdrie',
}

if (envPath === '.env.supabase') {
  Object.assign(process.env, SUPABASE_ENV)
} else if (envPath) {
  dotenv.config({ path: envPath, override: true })
} else {
  dotenv.config()
}

export {}
