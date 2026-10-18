# Backups and undo

There are two safety nets.

## 1. Undo history (for bulk jobs)

Every bulk job is recorded as a batch: merges, quick merges, Spotify
matching, and later auto sub-versions and imports. Open **undo history** in
the admin menu (`/admin/batches`) to see what each job changed and reverse it
in one click.

- Anything edited after the job ran is left alone, never overwritten.
- Undoing is recorded too, so you can undo an undo.
- History is kept for 60 days.

New bulk jobs join this by calling `sc_begin_batch('<kind>', '<label>')` at
the start of a database function. Server jobs that make many separate calls
use `sc_job_batch(...)` and send the id as an `x-sc-batch` header with the
service key (see `supabase/functions/match-spotify`).

## 2. Nightly database backup

`.github/workflows/database-backup.yml` runs every night at 03:17 UTC (and
on demand from GitHub > Actions > Database backup > Run workflow). It saves
the whole public schema plus `auth.users`, locked with your backup password,
and keeps each night's file for 30 days.

### One-time setup

1. Supabase > your project > **Connect** > **Session pooler**: copy the
   connection string and put your database password in place of
   `[YOUR-PASSWORD]`. (If you don't know the password, reset it under
   Project Settings > Database.)
2. GitHub > static-cuts > **Settings > Secrets and variables > Actions >
   New repository secret**:
   - `SUPABASE_DB_URL` = the connection string from step 1
   - `BACKUP_PASSPHRASE` = a long password you'll keep somewhere safe
     (a password manager). Without it a backup can't be opened.
3. GitHub > **Actions > Database backup > Run workflow** to test it. The run
   page shows the row counts and has the backup file at the bottom.

### Restoring

Only needed if something has gone badly wrong. Download the backup file from
the run page, then:

```sh
gpg --decrypt static-cuts-YYYY-MM-DD.tar.gz.gpg > backup.tar.gz
tar -xzf backup.tar.gz
cat backup/counts.txt   # check it's the one you want
```

To restore a single table into the live database (for example `ratings`),
it's safest to restore into a fresh Supabase project or branch first and
copy across what's missing. Ask Claude to walk through it with the files.
