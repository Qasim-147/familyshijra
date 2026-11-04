# Family Shijra (شجرۂ نسب) Website

A beautiful, mobile-friendly, search-engine-friendly family tree (shijra) that the family builds together.

- **Homepage with your family photo**: the haveli photo sits in an arched gold frame beside the title, with a badge naming the founding couple. Admins can replace it in **Admin → Settings → Homepage photo** (`assets/img/haveli.jpg` is the default).
- **Family explorer (works like File Explorer)**: every person is a folder holding their husband or wives and children. A man with two or more wives shows a separate group for each wife's children ("Children with Akbari Begam (1st wife)").
  - Collapsible folder tree on the left, address bar with clickable path and drop-down arrows, Back / Forward / Up buttons, search box.
  - Views: **Icons**, **Details** (sortable columns) and **Tree** (the graphical tree, rooted at the open folder). Visitors also get a **View as tree** button on the homepage.
  - Details pane on the right, status bar, collapsible groups, right-click menu (Open, View profile, Add relative, Copy link, Edit, Delete…).
  - Minimize and maximize buttons on the window; keyboard support (arrows, Enter to open, Backspace to go up, F2 to edit, Delete to delete for admins).
  - On phones: tap a folder to open it, the folder tree slides in from the left.
- **Collapsible homepage sections**: Elders, How are we related? and Recently added fold open and closed.
- **"Who are you in this family?"**: a visitor picks themselves once and every card shows *Your Dada*, *Your Khala*, *Your Bhatija*…
- **Relationship finder with family words**: Dada/Dadi, Nana/Nani, Par-dada, Chacha/Taya/Phuphi, Mamu/Khala, Chachazad/Mamuzad bhai, Bhanja/Bhatija, Pota/Nawasa, Saas/Sasur, Bhabhi, Behnoi, Devar/Jeth, Nanad, Saala/Saali, Damad/Bahu, Chachi/Mumani/Khalu/Phupha, alongside the English relation and the path.
- **Shijra Helper chat** (free, no API key): understands English plus Urdu/Hindustani family words. "Who is my dada?", "How is Hamza related to Imran?", "khala of Hamza", "children of Bade Abba", counts, eldest, how to add or correct someone. Typing indicator and an optional greeting bubble.
- **Visitors view only**: they browse the explorer, the tree, profiles and the helper. Only the admin adds or changes entries.
- **Direct publish**: whatever the admin saves appears for everyone at once. There is no submission or approval step.
- **Entered by**: every entry records the name of the admin who made it (remembered on that device), shown to admins in profiles and the People table.
- **Several wives and their lineage**: add wives in order (1st, 2nd…); when adding a child, pick which wife is the mother. The tree draws one lane per wife with her children, and family words cover Sautela bhai, Sauteli Ammi and Sautan.
- **Form fields on or off**: in **Admin → Settings → Form fields** the admin chooses which fields the entry form shows (middle name, nickname, dates, places, occupation, story, photo, maiden name…). Turning a field off hides it from the form but keeps any saved value.
- **Admin, full add / edit / delete everywhere**: edit, add-relative and delete buttons on every tree card, in every profile and in the People table; hide/show anyone; backup and restore; remove the sample family in one click.
- **Feature switches**: each homepage section, search, relationship finder, family words, helper chat and its greeting, spouses, generation numbers, starting ancestor, generations open on load, entry form fields, privacy of living people, announcement banner, Urdu title.
- **SEO**: every public person gets their own static page with schema.org data, plus an A–Z list, sitemap and robots.txt, rebuilt automatically.

It runs entirely on free tiers: **GitHub Pages** (hosting) + **Supabase** (database, photo storage, admin login).

---

## 1. Try it locally (2 minutes)

```bash
cd family-tree
python3 -m http.server 8000      # or: npx serve
```
Open http://localhost:8000. Without Supabase configured it runs in **setup preview**: a sample family loads, you are admin, and changes are saved only in your browser.

## 2. Create the Supabase project (10 minutes)

1. Sign up at https://supabase.com → **New project** (pick a region near your users, e.g. Mumbai).
2. **SQL Editor → New query**, paste all of `supabase/schema.sql`, click **Run**.
   This creates the tables, security rules, live updates and the `photos` storage bucket.
3. **Authentication → Users → Add user**: the admin's email and password, tick **Auto confirm user**.
4. Back in **SQL Editor**, make that user an admin:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'admin@example.com';
   ```
   Repeat for any other admins.
5. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up" so only admins you create can log in.
6. **Project Settings → API**: copy the **Project URL** and the **anon public** key into `assets/js/config.js`.
   Never use the `service_role` key in this site.

## 3. Publish on GitHub Pages (5 minutes)

1. Create a GitHub repository and push this folder to the `main` branch.
2. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The **Build and deploy** workflow runs on every push. Your site appears at
   `https://<username>.github.io/<repo>/` (shown in Settings → Pages).
4. In `assets/js/config.js`, set `siteUrl` to that address so shared links point to the right place, then push again.

**Custom domain** (e.g. `deshpandefamily.in`): add it in Settings → Pages, create the DNS records GitHub shows you, and add a file named `CNAME` containing the domain. Also add it to Supabase **Authentication → URL Configuration → Site URL** so password-reset emails link back correctly.

## 4. First steps as admin

1. Open the site → **Admin sign-in** (link in the footer; the Admin button only shows once you are signed in) → sign in.
2. **Data → Restore or import**: optionally upload `sample-family.json` to see a demo, then **Remove sample people** when you're ready.
3. **People → Add person**: start with the eldest ancestor, then add children using the **Father / Mother** fields.
4. **Settings**: site name, tagline, about text (used by Google), which ancestor the tree starts from, and feature switches.

## Feature switches (Admin → Settings)

| Switch | What it does |
| --- | --- |
| Form fields | Which fields appear on the admin's entry form (Entered by, dates, places, occupation, story, photo, maiden name…) |
| Search box | Name and place search in the header |
| Relationship finder | "How are you related?" on every profile |
| Shijra Helper chat / greeting bubble | The helper in the corner and its pop-up greeting |
| Use family words for relations | Dada, Nani, Chacha, Khala… next to English |
| Founders badge, Our elders, Recently added | Show or hide each homepage section |
| Family explorer opens as | Icons, Details list or Tree view |
| Homepage photo | Upload your own photo, or go back to the default |
| Show birth dates and places of living people | Off by default for privacy |
| Show husbands and wives / generation numbers | Tree display options |
| Generations shown when the page opens | 1–8; visitors expand the rest by tapping |
| Start the tree from | Any ancestor; leave empty to use the founder with the largest family |
| Announcement banner | A message across the top of the site |

Each person also has a **Show on the public tree** switch (Admin → People), so an admin can keep someone visible to admins only.

## How entries are published

1. The admin signs in, opens a person and taps **Add a relative** (or **People → Add person**), picks the relationship (for a man with several wives: "Son or daughter with [wife]"), fills in the name, **Entered by** and any other switched-on fields, and saves.
2. The person appears in the tree for everyone immediately. Their search-engine page appears at the next scheduled build (every 6 hours), or right away via **Actions → Build and deploy → Run workflow**.

## SEO

- `scripts/prerender.mjs` runs in GitHub Actions and writes, for every public person, `person/<name>/index.html` with a real title, description, Open Graph tags and schema.org `Person` data (parents, spouse, children, siblings), plus `people/` (A–Z list), `sitemap.xml`, `robots.txt` and `404.html`.
- The homepage gets the site name, description and a crawlable list of links.
- Living people's private details are left out of these pages unless you turn that setting on.
- After the first deploy, add the site in **Google Search Console** and submit `sitemap.xml`.

## Files

```
index.html                  App shell and SEO head
assets/css/style.css        All styles (light and dark themes, mobile layout)
assets/js/config.js         Your Supabase URL and anon key
assets/js/family.js         Family logic: relationships, search, dates (shared with the SEO builder)
assets/js/store-supabase.js Data layer (Supabase, or browser-only setup preview)
assets/js/app.js            Tree, profiles, forms, admin panel
assets/js/bot.js            Family Helper chat
supabase/schema.sql         Database, security rules and photo storage
scripts/prerender.mjs       Builds dist/ with SEO pages
.github/workflows/deploy.yml  Builds and deploys to GitHub Pages
sample-family.json          Example Siddiqui family for demos (marked as sample)
demo/                       Single-file demo build used for the hosted preview
```

## Limits and scaling

- Supabase free tier: 500 MB database (hundreds of thousands of people) and 1 GB photo storage. Photos are resized in the browser before upload (about 60–120 KB each), so roughly 10,000 photos fit.
- Free Supabase projects pause after a week with no visits; any visit wakes them, or upgrade to Pro to keep it always on.
- The tree loads the whole family list once (light text only) and draws branches only as they're expanded, which stays fast into the tens of thousands of people.

## Security

Only signed-in admins can write: the database rejects any insert or update from visitors, and only admins can upload photos.
