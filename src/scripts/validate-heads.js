const fs = require('fs');
const path = require('path');
const opportunities = require('../data/opportunities.json');
const opportunityQuality = require('../assets/opportunity-quality');
const opportunityLocation = require('../assets/opportunity-location');
const root = path.join(__dirname, '..', '..');

function readFileSafe(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}

function extract(html, tag) {
  if (!html) return '';
  const re = new RegExp(tag, 'i');
  const m = html.match(re);
  return m ? (m[1] || m[0]).trim() : '';
}

function getField(html, name) {
  if (!html) return '';
  const title = html.match(/<title>([^<]*)<\/title>/i);
  if (name === 'title') return title ? title[1].trim() : '';
  const desc = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']\s*\/>/i) || html.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']\s*\/>/i);
  if (name === 'description') return desc ? desc[1].trim() : '';
  const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']\s*\/?>/i);
  if (name === 'canonical') return canonical ? canonical[1].trim() : '';
  const robots = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']*)["']\s*\/?\>/i);
  if (name === 'robots') return robots ? robots[1].trim() : '';
  const ogUrl = html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']*)["']\s*\/?\>/i);
  if (name === 'og:url') return ogUrl ? ogUrl[1].trim() : '';
  return '';
}

function sampleOpportunities(count = 5) {
  return opportunities.slice(0, count);
}

function printSampleHeads() {
  const samples = sampleOpportunities(5);
  console.log('\nValidation: sample opportunity pages (title, description, canonical, robots, og:url)\n');
  for (const o of samples) {
    const rel = path.join(root, 'public', 'bids', o.state, o.trade, o.postedDate, o.slug, 'index.html');
    const html = readFileSafe(rel);
    console.log('---', o.id);
    if (!html) { console.log('  MISSING FILE:', rel); continue; }
    const title = getField(html, 'title');
    const desc = getField(html, 'description');
    const canonical = getField(html, 'canonical');
    const robots = getField(html, 'robots');
    const ogUrl = getField(html, 'og:url');
    const hasOgTitle = html.includes('og:title');
    const hasOgDesc = html.includes('og:description');
    console.log('  title:        ', title ? '✓' : '✗');
    console.log('  description:  ', desc ? '✓' : '✗');
    console.log('  canonical:    ', canonical ? '✓' : '✗');
    console.log('  robots:       ', robots ? '✓ (' + robots + ')' : '✗');
    console.log('  og:title:     ', hasOgTitle ? '✓' : '✗');
    console.log('  og:description:', hasOgDesc ? '✓' : '✗');
    console.log('  og:url:       ', ogUrl ? '✓' : '✗');
  }
}

function printSitemapSample() {
  const sitemap = readFileSafe(path.join('public','sitemap.xml'));
  if (!sitemap) { console.log('\nNo sitemap.xml found in public/'); return; }
  const urlMatch = sitemap.match(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/i);
  if (!urlMatch) { console.log('\nNo <url> entries found in sitemap.xml'); return; }
  console.log('\nSitemap sample:');
  console.log('  url:     ', urlMatch[1]);
  console.log('  lastmod: ', urlMatch[2] || '(none)');
}

function findHtmlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? findHtmlFiles(file) : entry.name.endsWith('.html') ? [file] : [];
  });
}

function validateNoNakedDueBadges() {
  const publicRoot = path.join(root, 'public');
  const nakedDueBadge = /<span\b[^>]*class=["'][^"']*\bpill\b[^"']*["'][^>]*>\s*Due\s*<\/span>/i;
  const failures = findHtmlFiles(publicRoot).filter(file => nakedDueBadge.test(readFileSafe(file)));

  console.log('\nValidation: no naked Due badges');
  if (!failures.length) {
    console.log('  ✓ No generated HTML pill contains only "Due".');
    return true;
  }

  for (const file of failures) {
    console.error('  ✗', path.relative(root, file));
  }
  return false;
}

function validateOpportunityQuality() {
  const failures = [];

  for (const opportunity of opportunities) {
    const file = path.join(
      root,
      'public',
      'bids',
      opportunity.state,
      opportunity.trade,
      opportunity.postedDate,
      opportunity.slug,
      'index.html'
    );
    const html = readFileSafe(file);
    const quality = opportunityQuality.enrichOpportunity(opportunity);

    if (!html) {
      failures.push(`${opportunity.id}: generated page missing`);
      continue;
    }
    if (!html.includes(quality.deadlineStatus)) {
      failures.push(`${opportunity.id}: missing deadline status "${quality.deadlineStatus}"`);
    }
    if (!html.includes(quality.sourceConfidence.label)) {
      failures.push(`${opportunity.id}: missing source confidence indicator`);
    }
    if (new RegExp(`${quality.sourceConfidence.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\d`).test(html)) {
      failures.push(`${opportunity.id}: exposes numeric source confidence`);
    }
  }

  console.log('\nValidation: opportunity deadline and confidence indicators');
  if (!failures.length) {
    console.log(`  ✓ Validated ${opportunities.length} generated opportunity pages.`);
    return true;
  }
  for (const failure of failures) console.error('  ✗', failure);
  return false;
}

function validateComputedFieldsAreNotPersisted() {
  const persisted = opportunities.filter(opportunity =>
    Object.prototype.hasOwnProperty.call(opportunity, 'sourceConfidence')
    || Object.prototype.hasOwnProperty.call(opportunity, 'deadlineStatus')
  );

  console.log('\nValidation: computed quality fields stay out of opportunities.json');
  if (!persisted.length) {
    console.log('  ✓ Confidence and deadline status are computed at render time.');
    return true;
  }
  for (const opportunity of persisted) console.error('  ✗', opportunity.id);
  return false;
}

function validateLocations() {
  const invalidRecords = opportunities.filter(opportunity =>
    String(opportunity.city || '').trim().toLowerCase() === 'colorado'
  );
  const publicRoot = path.join(root, 'public');
  const invalidPages = findHtmlFiles(publicRoot).filter(file =>
    /(?:^|>)\s*Colorado,\s*CO\s*(?:<|$)/i.test(readFileSafe(file))
  );
  const missingLabels = opportunities.filter(opportunity => {
    const location = opportunityLocation.normalizeLocation(opportunity);
    return !location.locationLabel;
  });

  console.log('\nValidation: normalized opportunity locations');
  if (!invalidRecords.length && !invalidPages.length && !missingLabels.length) {
    console.log(`  ✓ Validated ${opportunities.length} records with no "Colorado, CO" locations.`);
    return true;
  }
  for (const opportunity of invalidRecords) console.error('  ✗ invalid city:', opportunity.id);
  for (const file of invalidPages) console.error('  ✗ invalid page:', path.relative(root, file));
  for (const opportunity of missingLabels) console.error('  ✗ missing location label:', opportunity.id);
  return false;
}

function main() {
  printSampleHeads();
  printSitemapSample();
  const valid = [
    validateNoNakedDueBadges(),
    validateOpportunityQuality(),
    validateComputedFieldsAreNotPersisted(),
    validateLocations()
  ].every(Boolean);
  if (!valid) process.exitCode = 1;
}

main();
