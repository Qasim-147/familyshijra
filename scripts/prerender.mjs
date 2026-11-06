#!/usr/bin/env node
/* Builds the deployable site into ./dist and pre-renders search-engine pages:
     dist/person/<slug>/index.html   one page per public family member (with Person structured data)
     dist/people/index.html          A–Z list of everyone (helps Google discover every page)
     dist/sitemap.xml, dist/robots.txt, dist/404.html
   Data comes from Supabase using the public anon key in assets/js/config.js (so only public people are included).
   If Supabase isn't configured yet, the sample family is used so you can preview the output.

   Usage:  SITE_URL=https://yourname.github.io/family-tree/ node scripts/prerender.mjs */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const F = createRequire(import.meta.url)(path.join(root, 'assets/js/family.js'));

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

// ---------- read config ----------
const cfgText = readFileSync(path.join(root, 'assets/js/config.js'), 'utf8');
const pick = (k) => (cfgText.match(new RegExp(`${k}\\s*:\\s*['"]([^'"]*)['"]`)) || [])[1] || '';
const SUPABASE_URL = process.env.SUPABASE_URL || pick('supabaseUrl');
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || pick('supabaseAnonKey');
const configured = SUPABASE_URL && !/YOUR-PROJECT/.test(SUPABASE_URL) && SUPABASE_KEY && !/YOUR-ANON/.test(SUPABASE_KEY);
let SITE = (process.env.SITE_URL || pick('siteUrl') || 'https://example.github.io/family-tree/').trim();
if (!SITE.endsWith('/')) SITE += '/';

async function rest(pathAndQuery, headers = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...headers } });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}
async function loadData() {
  if (!configured) {
    console.log('Supabase not configured — building from sample-family.json');
    const s = JSON.parse(readFileSync(path.join(root, 'sample-family.json'), 'utf8'));
    return { people: s.people.map((p) => F.upperPerson({ ...p, slug: p.slug || F.slugify(p) })), settings: s.settings || {} };
  }
  const people = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(`people?select=*&visible=eq.true&order=id`, { Range: `${from}-${from + 999}` });
    people.push(...page);
    if (page.length < 1000) break;
  }
  const st = await rest('settings?select=data&id=eq.1');
  return { people: people.map(F.upperPerson), settings: (st[0] && st[0].data) || {} };
}

// ---------- templates ----------
const pageCss = `
:root{--night:#0b3a32;--bg:#eef4f1;--surface:#fff;--ink:#10221d;--muted:#56685f;--line:#d3dfd9;--accent:#17705f;--gold:#b88f3a;--gold-soft:#f3e9d2;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--night:#071f1b;--bg:#0b1714;--surface:#12231f;--ink:#e7efea;--muted:#9fb3a9;--line:#2a403a;--accent:#4fbf9f;--gold:#d6b264;--gold-soft:#3a3020;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 "Nunito Sans","Segoe UI",system-ui,sans-serif}
a{color:var(--accent)}header{background:var(--night);padding:16px}header .in,main{max-width:860px;margin:0 auto}
header a{color:#f3e6c4;font:600 1.15rem "Reem Kufi",system-ui,sans-serif;text-decoration:none}
main{padding:32px 16px 64px}.card{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:28px}
.hero{display:flex;gap:24px;align-items:center;flex-wrap:wrap}
.ph{width:120px;height:146px;border-radius:999px 999px 16px 16px;object-fit:cover;background:#dcebe5;display:grid;place-items:center;font:600 2.4rem "Reem Kufi",system-ui;color:var(--accent);box-shadow:0 0 0 3px var(--surface),0 0 0 5px var(--gold)}
h1{font:600 2.1rem/1.15 "Reem Kufi",system-ui,sans-serif;margin:0;text-wrap:balance}.yrs{color:var(--muted);font-variant-numeric:tabular-nums}.nick{color:var(--gold);font-weight:700}
dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;margin:24px 0}dt{color:var(--muted)}dd{margin:0;font-weight:600}
h2{font:600 1.1rem "Reem Kufi",system-ui;margin:26px 0 8px}ul{margin:0;padding-left:20px}
.cta{display:inline-block;margin-top:26px;background:var(--night);color:#f3e6c4;padding:11px 20px;border-radius:999px;text-decoration:none;font-weight:700}
.az{columns:3 220px;list-style:none;padding:0}.az li{break-inside:avoid;padding:3px 0}.az small{color:var(--muted)}
.letter{font:600 1.5rem "Reem Kufi",system-ui;color:var(--gold);margin:20px 0 6px}footer{color:var(--muted);font-size:.9rem;margin-top:30px}`;

function shell({ title, description, canonical, image, body, ld, rel }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="profile"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}">
${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="icon" href="${rel}assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&family=Reem+Kufi:wght@600&display=swap">
<style>${pageCss}</style>
${ld ? `<script type="application/ld+json">${jsonLd(ld)}</script>` : ''}
</head><body>
${body}
</body></html>`;
}

function main() {
  return loadData().then(({ people, settings }) => {
    const S = { site_title: 'Our Family Tree', tagline: '', about: '', show_living_dates: false, ...settings };
    const idx = F.buildIndex(people);
    const priv = (p) => !S.show_living_dates && F.isLiving(p);
    const url = (p) => `${SITE}person/${p.slug}/`;

    rmSync(dist, { recursive: true, force: true });
    mkdirSync(dist, { recursive: true });
    cpSync(path.join(root, 'assets'), path.join(dist, 'assets'), { recursive: true });
    for (const f of ['manifest.webmanifest', 'CNAME', '.nojekyll']) if (existsSync(path.join(root, f))) cpSync(path.join(root, f), path.join(dist, f));
    if (!configured) cpSync(path.join(root, 'sample-family.json'), path.join(dist, 'sample-family.json'));
    writeFileSync(path.join(dist, '.nojekyll'), '');

    // ---- person pages ----
    for (const p of people) {
      if (!p.slug) p.slug = F.slugify(p);
      const name = F.fullName(p);
      const yrs = F.years(p, priv(p));
      const parents = F.parents(idx, p), spouses = F.spouses(idx, p.id), kids = F.children(idx, p.id), sibs = F.siblings(idx, p);
      const facts = [];
      const fact = (k, v) => { if (v) facts.push(`<dt>${k}</dt><dd>${esc(v)}</dd>`); };
      if (p.nickname) fact('Known as', p.nickname);
      if (p.maiden_name) fact('Born as', `${p.first_name} ${p.maiden_name}`);
      if (!priv(p)) fact('Born', [F.fmtDate(p.birth_date), p.birth_place].filter(Boolean).join(', '));
      if (!F.isLiving(p)) fact('Died', [F.fmtDate(p.death_date), p.death_place].filter(Boolean).join(', '));
      fact('Occupation', p.occupation);
      const link = (x) => `<li><a href="../${esc(x.slug || F.slugify(x))}/">${esc(F.fullName(x))}</a> <span class="yrs">${esc(F.years(x, priv(x)))}</span></li>`;
      const sect = (h, arr) => (arr.length ? `<h2>${h}</h2><ul>${arr.map(link).join('')}</ul>` : '');
      const rels = [parents.length && `child of ${parents.map(F.shortName).join(' and ')}`, spouses.length && `married to ${spouses.map(F.shortName).join(', ')}`, kids.length && `parent of ${kids.length}`].filter(Boolean).join('; ');
      const description = `${name}${yrs ? ` (${yrs})` : ''}${p.occupation ? `, ${p.occupation}` : ''}${!priv(p) && p.birth_place ? `, born in ${p.birth_place}` : ''}. ${rels ? rels[0].toUpperCase() + rels.slice(1) + '.' : ''} From ${S.site_title}.`.replace(/\s+/g, ' ').slice(0, 300);
      const ld = {
        '@context': 'https://schema.org', '@type': 'Person', name, url: url(p),
        givenName: p.first_name || undefined, familyName: p.last_name || undefined, alternateName: p.nickname || undefined,
        gender: p.gender === 'male' ? 'Male' : p.gender === 'female' ? 'Female' : undefined,
        birthDate: priv(p) ? undefined : p.birth_date || undefined, deathDate: p.death_date || undefined,
        birthPlace: !priv(p) && p.birth_place ? { '@type': 'Place', name: p.birth_place } : undefined,
        deathPlace: p.death_place ? { '@type': 'Place', name: p.death_place } : undefined,
        jobTitle: p.occupation || undefined, image: p.photo_url || undefined, description: p.bio ? p.bio.slice(0, 300) : undefined,
        parent: parents.map((x) => ({ '@type': 'Person', name: F.fullName(x), url: url(x) })),
        spouse: spouses.map((x) => ({ '@type': 'Person', name: F.fullName(x), url: url(x) })),
        children: kids.map((x) => ({ '@type': 'Person', name: F.fullName(x), url: url(x) })),
        sibling: sibs.map((x) => ({ '@type': 'Person', name: F.fullName(x), url: url(x) })),
      };
      const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: S.site_title, item: SITE },
        { '@type': 'ListItem', position: 2, name: 'All members', item: `${SITE}people/` },
        { '@type': 'ListItem', position: 3, name, item: url(p) }] };
      const body = `<header><div class="in"><a href="../../">${esc(S.site_title)}</a></div></header>
<main><article class="card">
  <div class="hero">${p.photo_url ? `<img class="ph" src="${esc(p.photo_url)}" alt="Photo of ${esc(name)}" width="128" height="128">` : `<div class="ph" aria-hidden="true">${esc(F.initials(p))}</div>`}
  <div><h1>${esc(name)}</h1>${p.nickname ? `<div class="nick">${esc(p.nickname)}</div>` : ''}<div class="yrs">${esc(yrs)}</div></div></div>
  ${facts.length ? `<dl>${facts.join('')}</dl>` : ''}
  ${p.bio ? `<h2>Story</h2><p>${esc(p.bio).replace(/\n/g, '<br>')}</p>` : ''}
  ${sect('Parents', parents)}${sect(spouses.length > 1 ? 'Spouses' : 'Spouse', spouses)}${sect('Children', kids)}${sect('Siblings', sibs)}
  <a class="cta" href="../../#p-${esc(p.slug)}">See ${esc(F.shortName(p))} in the shijra</a>
</article>
<footer><a href="../../people/">All family members</a> · <a href="../../">Interactive shijra</a></footer></main>`;
      const dir = path.join(dist, 'person', p.slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'index.html'), shell({ title: `${name}${yrs && yrs !== 'Living' ? ` (${yrs})` : ''} – ${S.site_title}`, description, canonical: url(p), image: p.photo_url, body, ld: [JSON.parse(jsonLd(ld)), crumbs], rel: '../../' }));
    }

    // ---- A–Z list ----
    const sorted = [...people].sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '') || F.fullName(a).localeCompare(F.fullName(b)));
    let azHtml = ''; let letter = '';
    for (const p of sorted) {
      const L = ((p.last_name || p.first_name || '#')[0] || '#').toUpperCase();
      if (L !== letter) { if (letter) azHtml += '</ul>'; letter = L; azHtml += `<div class="letter">${esc(L)}</div><ul class="az">`; }
      azHtml += `<li><a href="../person/${esc(p.slug)}/">${esc(F.fullName(p))}</a> <small>${esc(F.years(p, priv(p)))}</small></li>`;
    }
    if (letter) azHtml += '</ul>';
    const surnames = [...new Set(people.map((p) => p.last_name).filter(Boolean))];
    mkdirSync(path.join(dist, 'people'), { recursive: true });
    writeFileSync(path.join(dist, 'people', 'index.html'), shell({
      title: `All family members – ${S.site_title}`,
      description: `${people.length} members of the ${S.site_title}${surnames.length ? `, including the ${surnames.slice(0, 6).join(', ')} families` : ''}.`,
      canonical: `${SITE}people/`, rel: '../',
      body: `<header><div class="in"><a href="../">${esc(S.site_title)}</a></div></header><main><div class="card"><h1>All family members</h1>${S.about ? `<p>${esc(S.about)}</p>` : ''}<p class="yrs">${people.length} people</p>${azHtml}<a class="cta" href="../">Open the interactive tree</a></div></main>`,
      ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `All family members – ${S.site_title}`, url: `${SITE}people/` },
    }));

    // ---- index.html with real title/description ----
    const desc = (S.about || `Explore the ${S.site_title}: ${people.length} family members across generations, with photos, dates and stories. Add your branch of the family.`).replace(/\s+/g, ' ').slice(0, 300);
    const head = `<title>${esc(S.site_title)}${S.tagline ? ` – ${esc(S.tagline)}` : ''}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(SITE)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(S.site_title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(SITE)}">
<meta property="og:image" content="${esc(/^https?:/.test(S.hero_image || '') ? S.hero_image : SITE + 'assets/img/haveli.jpg')}"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@type': 'WebSite', name: S.site_title, url: SITE, description: desc })}</script>`;
    let index = readFileSync(path.join(root, 'index.html'), 'utf8');
    index = index.replace(/<!--SEO-HEAD-START-->[\s\S]*?<!--SEO-HEAD-END-->/, head);
    // A plain list of links for crawlers that don't run JavaScript.
    const crawl = `<noscript><h2>${esc(S.site_title)}</h2><p>${esc(desc)}</p><ul>${sorted.slice(0, 500).map((p) => `<li><a href="person/${esc(p.slug)}/">${esc(F.fullName(p))}</a></li>`).join('')}</ul><p><a href="people/">All family members</a></p></noscript>`;
    index = index.replace(/<noscript>[\s\S]*?<\/noscript>/, crawl);
    writeFileSync(path.join(dist, 'index.html'), index);

    // ---- sitemap, robots, 404 ----
    const today = new Date().toISOString().slice(0, 10);
    const urls = [SITE, `${SITE}people/`, ...people.map(url)];
    writeFileSync(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
    writeFileSync(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
    writeFileSync(path.join(dist, '404.html'), shell({ title: `Page not found – ${S.site_title}`, description: 'This page does not exist.', canonical: SITE, rel: SITE, body: `<main><div class="card"><h1>Page not found</h1><p>This person or page may have moved.</p><a class="cta" href="${esc(SITE)}">Go to the family tree</a></div></main>` }));

    console.log(`Built ${people.length} person pages → dist/ (site: ${SITE})`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
