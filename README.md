# Sop and Bop's Wedding Balloon Parade

Guests draw a hot-air balloon on paper, photograph it, and the site cuts it out
in their browser. On the wedding day (Friday 16 October 2026), every approved
balloon drifts up a shared sky on the parade page.

- **Guest page:** `index.html`. Make a balloon (photo or draw on screen), add a name and note.
- **Parade:** `parade.html`, for the QR code in the wedding paper. Until you approve balloons
  it shows "The parade takes off on Friday 16 October" and how many are waiting.

It's plain HTML/CSS/JS in `site/` (no build step), Supabase for the database and
image storage, and Netlify for hosting.

## Launch day: reveal the parade

Open your project at <https://supabase.com/dashboard>, go to **SQL Editor**, paste
this and press **Run**:

```sql
update balloons set approved = true;
```

That's all. Open parade pages pick up new balloons within a minute, and anyone
scanning the QR code sees them straight away.

## Approving or hiding balloons

Nothing a guest sends appears until it's approved. Run these in the **SQL Editor**:

```sql
-- See everything waiting, newest first (open image_path links to look at them)
select created_at, name, note, source,
       'https://reubyfbbvfeuqrxvzioe.supabase.co/storage/v1/object/public/balloons/' || image_path as picture
from balloons where approved = false order by created_at desc;

-- Approve everything
update balloons set approved = true;

-- Hide one balloon again (by name, or use the id)
update balloons set approved = false where name = 'Their Name';

-- Hide everything (back to the waiting screen)
update balloons set approved = false;

-- Remove one for good
delete from balloons where id = 'the-id-here';
```

You can also click through it: **Table Editor → balloons**, then tick or untick
the `approved` box on any row.

**Balloons sent on WhatsApp:** make them yourself on the guest page (upload their
photo, type their name and note) and they arrive like any other.

## Backups: making sure no balloon is ever lost

There are four layers, so any one of them failing doesn't lose anything:

1. **On the guest's phone.** A balloon is saved on the device *before* it is sent and removed only once Supabase confirms it. If the signal drops, the page retries, and anything still unsent goes automatically the next time the guest opens the page. Guests can also tap **Save a copy** and send it on WhatsApp.
2. **In the database.** Every balloon added, changed or deleted is also copied into a `balloons_archive` table. A mistaken `update` or `delete` can be undone (below).
3. **Off-site, every 3 hours.** A GitHub Action copies every balloon (details and pictures) into the `backups` branch of this repository, **encrypted** with a passphrase only you know. The repository is public, so nothing readable goes there. A backup never forgets: if a balloon disappears from Supabase it stays in the backup, marked "missing_since". If a run fails, GitHub emails you.
4. **By hand, any time.** In Supabase: **Table Editor -> balloons -> Export -> CSV**, and **Storage -> balloons**, select all, **Download**.

### One-time setup (about 5 minutes)

1. **Supabase, SQL Editor:** paste and run `supabase/migrations/20261012000000_balloons_archive.sql` (it's safe to run more than once).
2. **Supabase, Project Settings -> API keys:** copy the **secret** key (or the legacy **service_role** key). Keep it private: it can read and change everything.
3. **GitHub, this repository -> Settings -> Secrets and variables -> Actions -> New repository secret**, add two secrets:
   - `SUPABASE_SERVICE_KEY`: the key from step 2
   - `BACKUP_PASSPHRASE`: a long passphrase you make up. **Write it down somewhere safe.** Without it the backups can't be opened.
4. **GitHub -> Actions -> "Back up balloons" -> Run workflow.** After a minute or so it should go green, and a `backups` branch appears. From then on it runs every 3 hours by itself.

### Undo a mistaken delete or update (from the archive)

In the SQL Editor:

```sql
-- put back any balloon that is no longer in the table, as it last was
insert into balloons
select (jsonb_populate_record(null::balloons, a.balloon)).*
from (select distinct on (balloon->>'id') balloon from balloons_archive order by balloon->>'id', archive_id desc) a
where not exists (select 1 from balloons b where b.id = (a.balloon->>'id')::uuid);
```

### Opening or restoring an off-site backup

Needs Node.js. Download the `backups` branch (GitHub -> branch "backups" -> Code -> Download ZIP), unzip it, then:

```sh
# readable copies: balloons.csv, balloons.json and every picture
BACKUP_PASSPHRASE='your passphrase' node scripts/decrypt-backup.mjs WeddingParade-backups readable-backup

# put everything missing back into Supabase (works on a brand-new project too,
# after running both files in supabase/migrations)
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_KEY=... BACKUP_PASSPHRASE='your passphrase' \
  node scripts/restore.mjs WeddingParade-backups
```

You can also run a backup on your own computer: `SUPABASE_SERVICE_KEY=... BACKUP_PASSPHRASE=... node scripts/backup.mjs my-backup`.

## Changing the WhatsApp number (or other text)

Edit `site/config.js`:

```js
whatsappDisplay: "07495 446864",
whatsappInternational: "+44 7495 446864",
whatsappLink: "https://wa.me/447495446864",   // wa.me/ + number in international format, no + or spaces
```

Then redeploy (below).

## Redeploying

After any change in `site/`:

```sh
./scripts/deploy.sh
```

This runs `npx netlify-cli deploy --prod --dir site`. It needs Node.js and asks you to
log in to Netlify the first time (or set `NETLIFY_AUTH_TOKEN`).

## First-time setup (already done, here for reference)

```sh
./scripts/setup.sh
```

This creates the Supabase project (London region), applies
`supabase/migrations/*.sql`, writes the project URL and anon key into
`site/config.js`, creates the Netlify site and deploys it.

### What the database allows

- Table `balloons`: `id`, `created_at`, `name` (1 to 60 characters), `note` (up to 280), `image_path`,
  `source` (`photo`/`drawn`) and `approved` (defaults to false).
- Anonymous visitors can **add** balloons, which always start unapproved, and can **read** only approved ones.
- `balloon_count()` returns how many have been sent in total, for the waiting screen.
- Storage bucket `balloons` is public-read. Visitors can upload PNGs up to 3 MB, but can't list,
  overwrite or delete them.

## How the photo cleanup works

All of it runs in the guest's browser (`site/js/cleanup.js`):

1. The photo is loaded the right way up (EXIF orientation), HEIC converted if needed, and scaled to 1600 px.
2. A crop box is pre-set around the drawing.
3. The paper colour is estimated across the image (bright percentile per cell, with a smooth
   lighting fit under big coloured areas) and divided out, so shadows disappear and paper turns white.
4. "Ink" is anything clearly darker or more colourful than paper. Small outline gaps are closed,
   and the outside is flood-filled from the crop edge. Everything not reached counts as balloon, so
   uncoloured insides stay solid white. The gap between the ropes is left see-through automatically.
5. Specks are removed (thin ropes are kept), and then the edge is softened, the colour boosted,
   the result trimmed and exported as a transparent PNG up to 800 px.

Guests can adjust **cleanup strength**, **redo the crop**, or tap a white gap to make it see-through.

## Testing

```sh
npm i playwright                         # once
python3 tests/make_synthetic.py tests/photos
node tests/run-cleanup-test.mjs out.png  # cut-outs of the synthetic photos
node tests/e2e.mjs                       # both routes + parade, against a fake backend
node tests/e2e.mjs --live                # the same against the real Supabase project
node tests/backup-test.mjs               # backup, decrypt and restore against a fake Supabase
```

Screenshots land in `tests/out/`.
