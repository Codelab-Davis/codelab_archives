# Archives administration setup

## Current status

The hosted Supabase project `tnebgoednnsnaloavypi` has both migrations and the legacy import applied: 27 imported records (17 events and 10 files). The initial UC Davis administrator is allowlisted. The local `.env.local` is configured with the public project URL and key and is ignored by Git; do not commit it. The independent Vercel staging project is deployed at **https://codelab-archives-staging.vercel.app**. The original production domain has not been changed. No real Google OAuth flow has been completed or verified.

## Authentication and environment

1. Google is now **enabled** in the hosted project using operator-provided OAuth credentials. The staging login was verified to redirect through Supabase to `accounts.google.com`, targeting `https://tnebgoednnsnaloavypi.supabase.co/auth/v1/callback`. A real officer still needs to complete Google consent and return to the dashboard before end-to-end sign-in is verified. For a new project, create a Google Cloud web OAuth client, configure its consent screen and authorized redirect URI, then enter its client ID and secret in Supabase's Google provider. Keep secrets out of Git and chat.
2. Set `ARCHIVE_AUTH_ORIGIN` to the exact canonical application origin, e.g. `https://archives.example.com`, without a path, query, or trailing slash. Use HTTPS for deployed environments; localhost HTTP is for development only. This is required for staging as well as production: configure the appropriate canonical origin for each deployment, and do not trust arbitrary request hosts as deployment configuration. Optionally set `NEXT_PUBLIC_SITE_URL` to the staging canonical URL for site metadata and generated URLs; when unset it defaults to the official archives domain. This does not replace `ARCHIVE_AUTH_ORIGIN`.
3. Configure Supabase Auth Site URL and redirect allowlist for the deployed origin. The app sends a `redirect_to` containing `/auth/callback?state=<random-state>`. A narrow pattern such as `https://archives.example.com/auth/callback?state=*` is needed rather than the bare callback alone. Supabase [documents](https://supabase.com/docs/guides/auth/redirect-urls) glob semantics: `?` matches one non-separator character, not a literal question mark; `*` matches any sequence excluding `.` and `/`. Escape the question mark as `\?` if accepted by the dashboard matcher to make it literal, and verify the actual pattern against real redirect URLs and an unintended URL before relying on it. Keep the origin and path exact; do not use a broad wildcard. Verify the complete real Google sign-in/callback flow after configuration.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project URL and public anon/publishable key. These are not administrative bypass credentials. Never configure a service-role key in the application. Restart after changing env values.
5. Officers must be explicitly provisioned in `public.archive_officers` with a lowercase UC Davis email. The DB also requires a confirmed user, a verified matching Google identity and Google-provider session; the domain alone does not grant access. Review `supabase/seed.sql` before using it. Test both authorized and unauthorized real users.

## Database, content, and assets

For a new project apply `supabase/migrations/20261114000000_archives.sql` followed by `supabase/migrations/20261115000000_published_assets.sql` using a reviewed migration process. The private `archive-assets` bucket allows officer uploads and reads; object replacement uses a new path. Anonymous Storage reads are limited by the published-asset manifest and published status; the application uses the anon key, not a service role. Publication writes the manifest with the snapshot; unpublishing removes access through the policy. Storage administrators can still change objects directly, so this is not tamper-proof archival storage. Verify deployed Storage behavior and MIME/size constraints in an isolated environment.

The importer `scripts/import-legacy-archive.mjs` converts the 27 legacy records and has already been applied to the hosted project; review its options and target before rerunning. Once Supabase is configured, published database snapshots are authoritative, including dynamic search and RSS; legacy fallback is for unconfigured environments. Saving creates a draft revision; publish copies it to the public snapshot. Version conflicts require reload and reconciliation. Archive/unpublish hides the snapshot; revisions remain available to officers.

The admin includes a rich visual editor with a Markdown fallback, plus preview and history. Test real editing, uploads, publication, unpublication, restore, and mobile rendering before use; local tests do not prove hosted behavior.

## Tests

Run `npm test` (or `node --test tests/*.test.mjs components/admin/*.test.mjs`). Route tests start isolated Next dev servers; `ARCHIVE_TEST_URL` optionally points the smoke test at an existing server. Their build directories are separate from `.next`.

Run `PGBIN=/path/to/postgresql/bin bash tests/security/run.sh` for the disposable local PostgreSQL security harness. It uses stub Auth/Storage schemas, not real Supabase services; it does not prove real OAuth, JWT handling, Storage HTTP, or browser integration. Never point it at an existing or remote database.

## Staging OAuth values

- Application origin and Site URL: `https://codelab-archives-staging.vercel.app`
- Application callback: `https://codelab-archives-staging.vercel.app/auth/callback` (allow its random `state` query as described above)
- Google authorized JavaScript origin: `https://codelab-archives-staging.vercel.app`
- Google authorized redirect URI: `https://tnebgoednnsnaloavypi.supabase.co/auth/v1/callback`
- For an external Google OAuth app in testing mode, add the intended officer accounts as Google test users.

The existing MCP grant can manage database/storage but lacks `auth_config_read`/`auth_config_write` management permissions. Configure the Google client credentials in the Supabase dashboard, or authorize a suitable management credential securely. Enabling the provider without valid Google client credentials does not create working Google sign-in.

## Release checks and recovery

`npm test` passes 17 tests covering mocked Auth/admin HTTP workflows, asset extraction, Markdown rendering and round trips, legacy migration conversion, and RSS. The local SQL harness checks RLS, verified officer identities, immutable history, draft/public isolation, conflicts, restore, and published-only asset access. Direct hosted anonymous REST checks confirmed published access and denial of draft tables, officer lists, revisions, manifests, and mutation RPCs. All 17 migrated event URLs returned HTTP 200 on staging. A temporary database fixture verified that draft content stays out of search/RSS, published content appears immediately in its page/search/RSS/sitemap, and archiving removes it from all four; the fixture was then removed, leaving the original 27 records. These are not a substitute for the first real officer login and hosted upload/publishing check.

Do not switch the production domain until real Google sign-in and the complete staging workflow pass. Keep the old deployment and legacy source available for rollback. Apply SQL changes through migrations; never erase revision history as part of a rollback. Configure an appropriate Supabase backup/export schedule before relying on the service for ongoing officer work.

Dependencies have been updated to a patched Next.js 15 release and the current audit reports no critical vulnerabilities. Inherited high/moderate dependency advisories remain; do not treat this as a clean dependency audit or apply breaking upgrades without checking the legacy content pipeline.
