# Supabase migration governance

`migrations/` is a canonical mirror of the production
`supabase_migrations.schema_migrations` history. The versions and normalized
SQL hashes captured in `production-migration-baseline.json` prevent an applied
migration from being renamed or edited silently.

For every new schema change:

1. Create the file with `supabase migration new <name>`.
2. Test the migration locally and run the database advisors.
3. Review `supabase db push --dry-run`, then apply it with `supabase db push`.
4. Confirm `supabase migration list` shows the same version locally and
   remotely.
5. Append the applied version and normalized SQL SHA-256 to the production
   baseline, then run the migration baseline test.

Do not edit an applied migration. Add a new forward-only migration instead.
Avoid applying a pre-created migration through an API that generates a
different timestamp. If an emergency change is applied that way, copy its
recorded SQL and generated version back into this directory before merging
more schema work. Do not repair migration history merely to make filenames
match; the production record is the source of truth.
