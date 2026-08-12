# Supabase migration governance

`migrations/` contains the canonical production
`supabase_migrations.schema_migrations` history plus reviewed pending changes.
The applied versions and normalized SQL hashes captured in
`production-migration-baseline.json` prevent production history from being
renamed or edited silently. `pendingMigrations` records files that have not yet
been confirmed by `supabase migration list`; pending entries are not a claim
that production has applied them.

For every new schema change:

1. Create the file with `supabase migration new <name>`.
2. Test the migration locally and run the database advisors.
3. Add the new file and hash to `pendingMigrations`, then review
   `supabase db push --dry-run` and apply it with `supabase db push`.
4. Confirm `supabase migration list` shows the same version locally and
   remotely.
5. Only after remote confirmation, move the entry from `pendingMigrations` to
   `migrations`, update `capturedAt`, and run the migration baseline test.

Do not edit an applied migration. Add a new forward-only migration instead.
Avoid applying a pre-created migration through an API that generates a
different timestamp. If an emergency change is applied that way, copy its
recorded SQL and generated version back into this directory before merging
more schema work. Do not repair migration history merely to make filenames
match; the production record is the source of truth.

If a version appears remotely but not in this repository, stop the deployment,
fetch and review the recorded SQL, and restore that exact version locally.
Never add an unverified or duplicate timestamp to the applied baseline merely
to make a branch test pass.
