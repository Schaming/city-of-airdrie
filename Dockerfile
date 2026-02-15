# To use this Dockerfile, you have to set `output: 'standalone'` in your next.config.js file.
# From https://github.com/vercel/next.js/blob/canary/examples/with-docker/Dockerfile

FROM node:22.17.0-slim AS base

# Install dependencies only when needed
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apt-get update && apt-get install -y libc6 && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
  echo "Using updated Dockerfile with legacy-peer-deps" && \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci --legacy-peer-deps; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi


# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED 1

# Use ARG to allow passing build-time environment variables
ARG PAYLOAD_SECRET
ARG DATABASE_URL
ARG DATABASE_AUTH_TOKEN
ARG S3_BUCKET
ARG S3_ENDPOINT
ARG S3_REGION
ARG S3_ACCESS_KEY_ID
ARG S3_SECRET_ACCESS_KEY
ARG PUBLIC_ASSET_BASE_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SERVER_URL
ARG OPENAI_API_KEY
ARG VECTOR_DATABASE_URL

# Set the ARGs as ENV for the build process
ENV PAYLOAD_SECRET=$PAYLOAD_SECRET
ENV DATABASE_URL=$DATABASE_URL
ENV DATABASE_AUTH_TOKEN=$DATABASE_AUTH_TOKEN
ENV S3_BUCKET=$S3_BUCKET
ENV S3_ENDPOINT=$S3_ENDPOINT
ENV S3_REGION=$S3_REGION
ENV S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID
ENV S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY
ENV PUBLIC_ASSET_BASE_URL=$PUBLIC_ASSET_BASE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL
ENV OPENAI_API_KEY=$OPENAI_API_KEY
ENV VECTOR_DATABASE_URL=$VECTOR_DATABASE_URL

RUN \
  export PAYLOAD_SECRET="${PAYLOAD_SECRET:-DUMMY_SECRET_FOR_BUILD}" && \
  export DATABASE_URL="${DATABASE_URL:-postgresql://build:build@localhost:1/build}" && \
  export DATABASE_AUTH_TOKEN="${DATABASE_AUTH_TOKEN:-}" && \
  export S3_BUCKET="${S3_BUCKET:-dummy}" && \
  export S3_ENDPOINT="${S3_ENDPOINT:-https://dummy.supabase.co}" && \
  export S3_REGION="${S3_REGION:-us-east-1}" && \
  export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-dummy}" && \
  export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-dummy}" && \
  export PUBLIC_ASSET_BASE_URL="${PUBLIC_ASSET_BASE_URL:-https://dummy.supabase.co}" && \
  export NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-http://localhost:3000}" && \
  export NEXT_PUBLIC_SERVER_URL="${NEXT_PUBLIC_SERVER_URL:-http://localhost:3000}" && \
  export OPENAI_API_KEY="${OPENAI_API_KEY:-}" && \
  export VECTOR_DATABASE_URL="${VECTOR_DATABASE_URL:-}" && \
  if [ -f yarn.lock ]; then yarn run build; \
  elif [ -f package-lock.json ]; then npm run build; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm run build; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Remove this line if you do not have this folder
COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD HOSTNAME="0.0.0.0" node server.js
