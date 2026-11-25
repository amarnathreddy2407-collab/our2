# OUR UNIVERSE
A public-facing relationship timeline, memories gallery, love-letter collection, and scratch-and-reveal experience built with Next.js and Supabase.

    pnpm install && pnpm dev

Public visitors do not sign in. Published content is read-only to visitors; an administrator unlocks editing with the server-only admin token. Media is stored in private Supabase buckets and served through short-lived signed URLs for published records.

## Public Supabase content and administrator writes

1. Review and apply `supabase/migrations/0002_secure_content_cloud.sql` in the Supabase SQL Editor. It creates the public-read content tables and media buckets, migrates legacy `entries` rows when present, and removes the legacy anonymous write policies. Do not run the deprecated `supabase/schema.sql`.
2. Configure the existing Vercel variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SECRET_KEY` for the deployment environment.
3. Configure the server-only `OUR_UNIVERSE_ADMIN_TOKEN` with a random value of at least 32 characters. Keep it secret; it is never compiled into browser code. The admin control exchanges it for a short-lived HttpOnly cookie.
4. Redeploy after applying the migration and confirming the variables are present.

Visitors can read published content and its short-lived signed media URLs without signing in. Only an administrator with the token can create, update, or delete content; mutations execute on the server with `SUPABASE_SECRET_KEY`. Without the migration, content routes show a retryable configuration error and do not fall back to browser persistence.
