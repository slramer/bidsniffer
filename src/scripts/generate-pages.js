const fs = require('fs');
const path = require('path');
const opportunities = require('../data/opportunities.json');

const root = path.join(__dirname, '../../public');
const trades = ['roofing', 'hvac', 'electrical', 'concrete', 'general'];

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function titleCase(s) { return s.replace(/\b\w/g, c => c.toUpperCase()); }
function layout({ title, description, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="header"><nav class="nav"><a class="logo" href="/">Bid<span>Sniffer</span></a><div class="navlinks"><a href="/bids/colorado/">Colorado Bids</a><a href="/contractors/profile.html">Contractor Profile</a></div></nav></header>
  ${body}
  <footer class="footer">BidSniffer tracks public construction opportunities and turns bid chaos into something slightly less cursed.</footer>
  <script src="/app.js"></script>
</body>
</html>`;
}
function write(file, html) { ensureDir(path.dirname(file)); fs.writeFileSync(file, html); }

write(path.join(root, 'index.html'), layout({
  title: 'BidSniffer | Construction Bid Intelligence',
  description: 'BidSniffer helps contractors discover, filter, and evaluate public construction bid opportunities.',
  body: `<section class="hero"><span class="badge">Colorado phase 1: roofing, HVAC, electrical, concrete</span><h1>Stop digging through bid portals like it’s 2009.</h1><p>BidSniffer collects public construction opportunities, classifies them by trade, and helps contractors spot projects worth pursuing.</p><div class="cta-row"><a class="button" href="/bids/colorado/">Browse Colorado Bids</a><a class="button secondary" href="/contractors/profile.html">Try Contractor Matching</a></div></section><main class="main"><section class="grid">${trades.map(t => `<a class="card" href="/bids/colorado/${t}/"><h3>${titleCase(t)} Bids</h3><p>Browse Colorado ${t} opportunities, deadlines, agencies, and AI-ready summaries.</p></a>`).join('')}</section></main>`
}));

write(path.join(root, 'bids/colorado/index.html'), layout({
  title: 'Colorado Construction Bids | BidSniffer',
  description: 'Browse Colorado public construction bid opportunities by trade.',
  body: `<section class="hero"><span class="badge">Colorado bid intelligence</span><h1>Colorado construction bids, without the portal swamp.</h1><p>Browse public opportunities by trade, region, due date, and contractor fit.</p></section><main class="main"><div class="grid">${trades.map(t => `<a class="card" href="/bids/colorado/${t}/"><h3>${titleCase(t)}</h3><p>${opportunities.filter(o=>o.trade===t).length} sample opportunities loaded.</p></a>`).join('')}</div><h2 style="margin-top:32px">Latest Opportunities</h2><div class="grid" data-opportunities></div></main>`
}));

for (const trade of trades) {
  write(path.join(root, `bids/colorado/${trade}/index.html`), layout({
    title: `Colorado ${titleCase(trade)} Bids | BidSniffer`,
    description: `Browse Colorado ${trade} bid opportunities, due dates, agencies, and project summaries.`,
    body: `<section class="hero"><span class="badge">${titleCase(trade)} opportunities</span><h1>Colorado ${titleCase(trade)} Bids</h1><p>Public ${trade} projects, summarized and organized for contractors who have better things to do than click through seventeen portals.</p></section><main class="main"><div class="notice"><strong>Colorado Vendor Self Service opportunities harvested automatically.
Additional public bid sources coming soon.</strong></div><h2 style="margin-top:28px">Latest ${titleCase(trade)} Opportunities</h2><div class="grid" data-opportunities data-trade="${trade}"></div></main>`
  }));
}

for (const o of opportunities) {
  write(path.join(root, `bids/${o.state}/${o.trade}/${o.postedDate}/${o.slug}/index.html`), layout({
    title: `${o.title} | BidSniffer`,
    description: `${o.summary}`,
    body: `<main class="main"><section class="card"><div class="meta"><span class="pill">${o.trade}</span><span class="pill warn">Due ${o.dueDate}</span><span class="pill">${o.city}, CO</span></div><h1 style="font-size:48px">${o.title}</h1><p>${o.summary}</p><h2>Bid Snapshot</h2><div class="grid"><div><strong>Agency</strong><p>${o.agency}</p></div><div><strong>Estimated Value</strong><p>${o.estimatedValue}</p></div><div><strong>Posted</strong><p>${o.postedDate}</p></div><div><strong>Due</strong><p>${o.dueDate}</p></div></div><h2>Potential Requirements</h2><ul>${o.requirements.map(r => `<li>${r}</li>`).join('')}</ul><p><a class="button" href="${o.sourceUrl}">View original source</a></p></section></main>`
  }));
}

write(path.join(root, 'contractors/profile.html'), layout({
  title: 'Contractor Profile Matcher | BidSniffer',
  description: 'Create a sample contractor profile and see matched Colorado construction opportunities.',
  body: `<section class="hero"><span class="badge">Monetization wedge</span><h1>Match bids to a contractor profile.</h1><p>This is the paid-feature seed: saved profiles, alerts, match scoring, deadline tracking, and bid-packet analysis.</p></section><main class="main"><form id="contractor-profile" class="card"><h2>Contractor Profile</h2><div class="filters"><label>Trade<select name="trade"><option value="">Any trade</option>${trades.map(t=>`<option value="${t}">${titleCase(t)}</option>`).join('')}</select></label><label>City / service area<input name="city" placeholder="Denver, Aurora, Lakewood" /></label><label>Must-have keywords<input name="keywords" placeholder="school, municipal, controls" /></label><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="publicWork" checked style="width:auto" /> Public work preferred</label></div></form><h2 style="margin-top:28px">Matched Opportunities</h2><div id="match-results" class="grid"></div></main>`
}));
