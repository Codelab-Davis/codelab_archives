# Archives administration setup

## Current status

The existing Supabase project `codelab_archives` (`tnebgoednnsnaloavypi`) is designated as Archives production. It has the archive migrations and legacy import applied, with 27 imported records (17 events and 10 files). The initial UC Davis administrator is allowlisted. Do not modify the separate `codelab-app` project. The local `.env.local` is ignored by Git.

The team Vercel project `codelabdavis-projects/codelab-archives` is connected to GitHub with deployment protection enabled. General pull request previews use legacy content. The team staging branch is retired, the personal staging deployment is paused, and `main` is reserved for production. An allowlisted officer signed in with Google and opened the hosted editor on the protected release-check preview. The live cutover requires approval.

## Authentication and environment

1. Google is **enabled** in the hosted project using operator-provided OAuth credentials. The previous staging login was verified to redirect through Supabase to `accounts.google.com`, targeting `https://tnebgoednnsnaloavypi.supabase.co/auth/v1/callback`. Verify that a real officer can complete sign-in and return to the dashboard in a protected release candidate with a canonical URL before changing the live domain. Keep secrets out of Git and chat.
2. Set `ARCHIVE_AUTH_ORIGIN` to the exact canonical application origin, e.g. `https://archives.example.com`, without a path, query, or trailing slash. Use HTTPS for deployed environments; localhost HTTP is for development only. Configure the appropriate canonical origin for the release candidate and production, and do not trust arbitrary request hosts as deployment configuration. Optionally set `NEXT_PUBLIC_SITE_URL` to the canonical URL for site metadata and generated URLs; when unset it defaults to the official archives domain. This does not replace `ARCHIVE_AUTH_ORIGIN`.
3. Configure Supabase Auth Site URL and redirect allowlist for the deployed origin. The app sends a `redirect_to` containing `/auth/callback?state=<random-state>`. A narrow pattern such as `https://archives.example.com/auth/callback?state=*` is needed rather than the bare callback alone. Supabase [documents](https://supabase.com/docs/guides/auth/redirect-urls) glob semantics: `?` matches one non-separator character, not a literal question mark; `*` matches any sequence excluding `.` and `/`. Escape the question mark as `\?` if accepted by the dashboard matcher to make it literal, and verify the actual pattern against real redirect URLs and an unintended URL before relying on it. Keep the origin and path exact; do not use a broad wildcard. Verify the complete real Google sign-in/callback flow after configuration.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project URL and public anon/publishable key. These are not administrative bypass credentials. Never configure a service-role key in the application. Restart after changing env values.
5. Officers must be explicitly provisioned in `public.archive_officers` with a lowercase UC Davis email. The DB also requires a confirmed user, a verified matching Google identity and Google-provider session; the domain alone does not grant access. Review `supabase/seed.sql` before using it. Test both authorized and unauthorized real users.

## Database, content, and assets

The four migration filenames match the history of the designated hosted Supabase project. The SQL is identical after normalizing line endings and trimming outer whitespace. Before applying a new migration, verify the target project and compare its migration history with the repository. If a local database used the previous filenames, rebuild disposable local databases from the current migrations. For any database with data to retain, reconcile the migration history after verifying the applied SQL before running another migration.

The private `archive-assets` bucket allows officer uploads and reads. Replacements use new paths. The `archive_asset_delivery` migration removes direct public object reads. Deploy the `archives-read-asset` Supabase Edge Function before deploying the updated Next app. Register the function with JWT verification enabled for the current legacy anon key. The app sends that key to the function. The function uses its Supabase-injected credential to look up the current published snapshot, check the exact attachment reference, and stream eligible bytes. The Next route and function both disable response caching. The Vercel app requires only the existing public Supabase settings.

Before release, verify direct Storage denial with a fresh test object while it is published. Confirm the same attachment URL through the app returns bytes when published and returns 404 after unpublish. Remove or purge any cached test objects previously exposed through the old policy. Changing an RLS policy does not invalidate existing CDN entries. See [Supabase Storage CDN guidance](https://supabase.com/docs/guides/storage/cdn/smart-cdn).

The 27 legacy records are already imported into the designated production database; do not rerun the import for release. The importer `scripts/import-legacy-archive.mjs` skips existing identities and is not a synchronization mechanism for later edits, revisions, or assets. Once Supabase is configured, published database snapshots are authoritative, including dynamic search and RSS; legacy fallback is for unconfigured environments. Saving creates a draft revision; publish copies it to the public snapshot. Version conflicts require reload and reconciliation. Archive/unpublish hides the snapshot; revisions remain available to officers.

The admin includes a rich visual editor with a Markdown fallback, plus preview and history. Test real editing, uploads, publication, unpublication, restore, and mobile rendering before use; local tests do not prove hosted behavior.

## Tests

Run `npm test` (or `node --test tests/*.test.mjs components/admin/*.test.mjs`). Route tests start isolated Next dev servers; `ARCHIVE_TEST_URL` optionally points the smoke test at an existing server. Their build directories are separate from `.next`.

Run `PGBIN=/path/to/postgresql/bin bash tests/security/run.sh` for the disposable local PostgreSQL security harness. It uses stub Auth/Storage schemas, not real Supabase services; it does not prove real OAuth, JWT handling, Storage HTTP, or browser integration. Never point it at an existing or remote database.

## Release-candidate OAuth

- Application origin and callback: use the verified canonical release-candidate URL and its `/auth/callback` path; configure and test the random `state` query as described above.
- Google authorized redirect URI: `https://tnebgoednnsnaloavypi.supabase.co/auth/v1/callback` (Google returns to Supabase here; Supabase then redirects to the application callback above)
- For an external Google OAuth app in testing mode, add the intended officer accounts as Google test users.

The release-candidate callback and officer sign-in passed on the protected preview. The release operator confirmed that Google sign-in with an account outside the officer allowlist was rejected. Configure hosted Auth in the Supabase dashboard or with an authorized management credential.

## Preview, release, and recovery

1. Open a pull request into `main`. GitHub requires one approving review and both checks, `App` and `Database`. Use the protected Vercel PR preview to review public pages with legacy content.
2. Set up a protected dedicated release candidate with a verified canonical URL and narrow Supabase Auth redirect allowlist. Complete Google consent with a real authorized officer and verify rejection of an unauthorized user. Exercise draft, upload, publish, unpublish, restore, search, RSS, and mobile rendering. These tests use the designated production backend, so protect the deployment and coordinate any test content and cleanup.
3. Retire the old personal staging deployment, remove its callback, and address its outstanding sessions before release. Verify the result. Configure the approved production URL and Auth origin, confirm backup and restore readiness, and obtain explicit approval before changing the live site or domain.
4. Retain the prior live deployment and legacy source and record the rollback owner and steps. To roll back, restore the prior site deployment or domain routing after approval, preserve database revisions, and reconcile writes made since cutover. Database restoration requires a reviewed recovery point and downtime plan; back up Storage objects separately because database backups do not contain their bytes.

`npm test` passes 17 tests covering mocked Auth/admin HTTP workflows, asset extraction, Markdown rendering and round trips, legacy migration conversion, and RSS. The local SQL harness checks RLS, verified officer identities, immutable history, draft/public isolation, conflicts, restore, and published-only asset access. Direct hosted anonymous REST checks confirmed published access and denial of draft tables, officer lists, revisions, manifests, and mutation RPCs. All 17 migrated event URLs returned HTTP 200 on staging. A temporary database fixture verified that draft content stays out of search/RSS, published content appears immediately in its page/search/RSS/sitemap, and archiving removes it from all four; the fixture was then removed, leaving the original 27 records. A separate archived test fixture verified the signed-in officer upload, publish, unpublish, and restore workflow. The protected preview also returned HTTP 409 for a stale save and preserved the newer draft. The two synthetic uploads were removed, and their old direct Storage URLs no longer return the files. The mobile editor and draft preview were also checked for horizontal overflow.

Do not switch the production domain until real Google sign-in and the complete release-candidate workflow pass. Keep the old deployment and legacy source available for rollback. Apply SQL changes through reviewed migrations; never erase revision history as part of a rollback. Configure a database backup/export schedule and separate Storage object backup, with retention and a tested restore, before relying on the service for ongoing officer work. Supabase paid plans provide scheduled database backups; Free projects need regular off-site exports. See [Supabase backups](https://supabase.com/docs/guides/platform/backups).

Dependencies have been updated to a patched Next.js 15 release and the current audit reports no critical vulnerabilities. Inherited high/moderate dependency advisories remain; do not treat this as a clean dependency audit or apply breaking upgrades without checking the legacy content pipeline.
