const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const opportunities = require('../data/opportunities.json');

const root = path.join(__dirname, '../../public');
const assetsRoot = path.join(__dirname, '../assets');
const trades = ['roofing', 'hvac', 'electrical', 'concrete', 'general'];

// Remove previously generated pages so deleted/stale opportunities do not linger.
fs.rmSync(path.join(root, 'bids'), { recursive: true, force: true });
fs.rmSync(path.join(root, 'contractors'), { recursive: true, force: true });

const tradeLabels = {
  roofing: 'Roofing',
  hvac: 'HVAC',
  electrical: 'Electrical',
  concrete: 'Concrete',
  general: 'General Construction'
};

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function copyAsset(name) {
  const source = path.join(assetsRoot, name);
  const destination = path.join(root, name);
  const content = fs.readFileSync(source);
  fs.copyFileSync(source, destination);
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 10);
}

ensureDir(root);
const assetVersions = {
  css: copyAsset('styles.css'),
  app: copyAsset('app.js')
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function tradeLabel(trade) {
  return tradeLabels[trade] || String(trade || 'General').replace(/\b\w/g, c => c.toUpperCase());
}


function daysFromToday(dateValue) {
  if (!dateValue) return null;
  const parsed = new Date(`${String(dateValue).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  return Math.round((parsed - today) / 86400000);
}

function urgencyPill(o) {
  const days = Number.isFinite(o.daysUntilDue) ? o.daysUntilDue : daysFromToday(o.dueDate);
  if (days === null || Number.isNaN(days) || days < 0 || days >= 7) return '';
  if (days === 0) return '<span class="pill urgent">Due Today</span>';
  if (days === 1) return '<span class="pill urgent">Due Tomorrow</span>';
  return `<span class="pill urgent">Due in ${days} days</span>`;
}

function displayValue(value) {
  if (!value || String(value).toLowerCase() === 'not listed') return 'Not listed by source';
  return value;
}

function sourceLookupBlock(o) {
  if (!o.sourceLookupInstructions && !Array.isArray(o.sourceLookupSteps) && !o.solicitationNumber && !o.solicitationRef) {
    return '';
  }

  const steps = Array.isArray(o.sourceLookupSteps) && o.sourceLookupSteps.length
    ? o.sourceLookupSteps
    : [
        `Open ${o.sourceName || 'the source site'}.`,
        o.sourceName === 'Colorado Vendor Self Service'
          ? 'Click "View Published Solicitations."'
          : 'Use the source site search.',
        o.solicitationNumber
          ? `Search for solicitation number ${o.solicitationNumber}.`
          : o.solicitationRef
            ? `Search for solicitation reference ${o.solicitationRef}.`
            : 'Search using the project title.'
      ];

  return `<section class="notice source-lookup">
    <h2>How to Find This on the Source Site</h2>
    ${o.sourceLookupInstructions ? `<p>${escapeHtml(o.sourceLookupInstructions)}</p>` : ''}
    <ol>${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
    ${o.solicitationNumber ? `<p><strong>Solicitation number:</strong> ${escapeHtml(o.solicitationNumber)}</p>` : ''}
    ${o.solicitationRef ? `<p><strong>Full source reference:</strong> ${escapeHtml(o.solicitationRef)}</p>` : ''}
    <p><a class="button" href="${escapeAttr(o.sourceUrl)}">Open ${escapeHtml(o.sourceName || 'Original Source')}</a></p>
  </section>`;
}

function requirementsList(requirements = []) {
  const cleaned = requirements.filter(Boolean);
  return cleaned.length
    ? `<ul>${cleaned.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
    : '<p>No source-specific requirements were captured yet.</p>';
}

function layout({ title, description, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}" />
  <link rel="stylesheet" href="/styles.css?v=${assetVersions.css}" />
</head>
<body class="landing">
  <header class="header"><nav class="nav"><a class="logo" href="/">Bid<span>Sniffer</span></a><div class="navlinks"><a href="/bids/colorado/">Colorado Bids</a><a href="/contractors/profile.html">Contractor Profile</a></div></nav></header>
  ${body}
  <footer class="footer">BidSniffer tracks public construction opportunities and turns bid chaos into something slightly less cursed.</footer>
  <script src="/app.js?v=${assetVersions.app}"></script>
</body>
</html>`;
}

function write(file, html) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, html);
}

write(path.join(root, 'index.html'), layout({
  title: 'BidSniffer | Construction Bid Intelligence',
  description: 'BidSniffer helps contractors discover, filter, and evaluate public construction bid opportunities.',
  body: `<section class="hero"><span class="badge">Colorado Beta • Public Construction Opportunities Updated Daily</span><h1>Stop digging through bid portals like it’s 2009.</h1><p>BidSniffer collects public construction opportunities, classifies them by trade, and helps contractors spot projects worth pursuing.</p><div class="cta-row"><a class="button" href="/bids/colorado/">Browse Colorado Bids</a><a class="button secondary" href="/contractors/profile.html">Try Contractor Matching</a></div></section><main class="main"><section class="grid">${trades.map(t => `<a class="card" href="/bids/colorado/${t}/"><h3>${escapeHtml(tradeLabel(t))} Bids</h3><p>Browse Colorado ${escapeHtml(tradeLabel(t).toLowerCase())} opportunities, deadlines, agencies, and source lookup details.</p></a>`).join('')}</section></main>`
}));

write(path.join(root, 'bids/colorado/index.html'), layout({
  title: 'Colorado Construction Bids | BidSniffer',
  description: 'Browse Colorado public construction bid opportunities by trade.',
  body: `<section class="hero"><span class="badge">Colorado bid intelligence</span><h1>Colorado construction bids, without the portal swamp.</h1><p>Browse public opportunities by trade, region, due date, and contractor fit.</p></section><main class="main"><div class="grid">${trades.map(t => `<a class="card" href="/bids/colorado/${t}/"><h3>${escapeHtml(tradeLabel(t))}</h3><p>${opportunities.filter(o=>o.trade===t).length} opportunities loaded.</p></a>`).join('')}</div><h2 style="margin-top:32px">Latest Opportunities</h2><div class="grid" data-opportunities></div></main>`
}));

for (const trade of trades) {
  write(path.join(root, `bids/colorado/${trade}/index.html`), layout({
    title: `Colorado ${tradeLabel(trade)} Bids | BidSniffer`,
    description: `Browse Colorado ${tradeLabel(trade).toLowerCase()} bid opportunities, due dates, agencies, and project summaries.`,
    body: `<section class="hero"><span class="badge">${escapeHtml(tradeLabel(trade))} opportunities</span><h1>Colorado ${escapeHtml(tradeLabel(trade))} Bids</h1><p>Public ${escapeHtml(tradeLabel(trade).toLowerCase())} projects, summarized and organized for contractors who have better things to do than click through seventeen portals.</p></section><main class="main"><div class="notice"><strong>Live public-source data.</strong> Colorado VSS opportunities are harvested automatically. Additional public bid sources coming soon.</div><h2 style="margin-top:28px">Latest ${escapeHtml(tradeLabel(trade))} Opportunities</h2><div class="grid" data-opportunities data-trade="${trade}"></div></main>`
  }));
}

for (const o of opportunities) {
  write(path.join(root, `bids/${o.state}/${o.trade}/${o.postedDate}/${o.slug}/index.html`), layout({
    title: `${o.title} | BidSniffer`,
    description: `${o.summary}`,
    body: `<main class="main"><section class="card"><div class="meta"><span class="pill">${escapeHtml(tradeLabel(o.trade))}</span><span class="pill warn">Due ${escapeHtml(o.dueDate)}</span>${urgencyPill(o)}<span class="pill">${escapeHtml(o.city)}, CO</span></div><h1 style="font-size:48px">${escapeHtml(o.title)}</h1><p>${escapeHtml(o.summary)}</p><h2>Bid Snapshot</h2><div class="grid"><div><strong>Agency</strong><p>${escapeHtml(o.agency)}</p></div><div><strong>Estimated Value</strong><p>${escapeHtml(displayValue(o.estimatedValue))}</p></div><div><strong>Posted</strong><p>${escapeHtml(o.postedDate)}</p></div><div><strong>Due</strong><p>${escapeHtml(o.dueDate)}</p></div>${o.solicitationNumber ? `<div><strong>Solicitation Number</strong><p>${escapeHtml(o.solicitationNumber)}</p></div>` : ''}${o.buyer ? `<div><strong>Buyer</strong><p>${escapeHtml(o.buyer)}</p></div>` : ''}${o.buyerEmail ? `<div><strong>Buyer Email</strong><p>${escapeHtml(o.buyerEmail)}</p></div>` : ''}<div><strong>Source</strong><p>${escapeHtml(o.sourceName || 'Original source')}</p></div></div>${sourceLookupBlock(o)}<h2>Potential Requirements</h2>${requirementsList(o.requirements)}</section></main>`
  }));
}

write(path.join(root, 'contractors/profile.html'), layout({
  title: 'Contractor Profile Matcher | BidSniffer',
  description: 'Create a sample contractor profile and see matched Colorado construction opportunities.',
  body: `<section class="hero"><span class="badge">Opportunity Matching</span><h1>Match bids to a contractor profile.</h1><p>Create a contractor profile and see which projects fit your business. Saved profiles, bid alerts, match scoring, deadline tracking, and bid analysis are coming soon.</p></section><main class="main"><form id="contractor-profile" class="card"><h2>Contractor Profile</h2><p class="form-note">Fit scores consider trade, service area, must-have keywords, deadline window, listed value, source completeness, and classification confidence.</p><div class="filters"><label>Trade<select name="trade"><option value="">Any trade</option>${trades.map(t=>`<option value="${t}">${escapeHtml(tradeLabel(t))}</option>`).join('')}</select></label><label>City / service area<input name="city" placeholder="Denver, Aurora, Lakewood" /></label><label>Must-have keywords<input name="keywords" placeholder="school, municipal, controls" /></label><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="publicWork" checked style="width:auto" /> Public work preferred</label></div></form><h2 style="margin-top:28px">Matched Opportunities</h2><div id="match-results" class="grid"></div></main>`
}));
