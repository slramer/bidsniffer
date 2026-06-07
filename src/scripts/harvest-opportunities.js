const fs = require('fs');
const path = require('path');
const { classifyTradeDetails } = require('../lib/trade-classifier');

const connectors = [
  require('../sources/colorado-vss'),
  require('../sources/cdot'),
  require('../sources/denver'),
  require('../sources/bidnet'),
  require('../sources/colorado-bid-network'),
  require('../sources/school-districts'),
  require('../sources/rtd.js')
];

const SRC_DATA_PATH = path.join(__dirname, '../data/opportunities.json');
const PUBLIC_DATA_PATH = path.join(__dirname, '../../public/data/opportunities.json');

function readJson(filePath, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function slugify(value) {
  return String(value || 'untitled-opportunity')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'untitled-opportunity';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDate(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(dateValue) {
  const date = parseIsoDate(dateValue);
  if (!date) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  return Math.round((date - today) / 86400000);
}

function urgencyFromDueDate(dueDate) {
  const days = daysUntil(dueDate);
  if (days === null) return { daysUntilDue: null, expiresSoon: false, dueStatus: '' };
  if (days < 0) return { daysUntilDue: days, expiresSoon: false, dueStatus: 'expired' };
  if (days === 0) return { daysUntilDue: days, expiresSoon: true, dueStatus: 'Due Today' };
  if (days === 1) return { daysUntilDue: days, expiresSoon: true, dueStatus: 'Due Tomorrow' };
  if (days < 7) return { daysUntilDue: days, expiresSoon: true, dueStatus: `Due in ${days} days` };
  return { daysUntilDue: days, expiresSoon: false, dueStatus: '' };
}

function isExpiredOpportunity(item) {
  const days = daysUntil(item.dueDate);
  return days !== null && days < 0;
}

function mergeKeywords(...groups) {
  return Array.from(new Set(
    groups
      .flat()
      .filter(Boolean)
      .map(value => String(value).toLowerCase())
  ));
}


function inferProjectFilters(raw = {}, trade = 'general') {
  const parts = [
    raw.title,
    raw.summary,
    raw.description,
    raw.scope,
    raw.projectType,
    raw.projectTypeLabel,
    raw.agency,
    raw.sourceName
  ];
  if (Array.isArray(raw.requirements)) parts.push(...raw.requirements);
  const text = parts.filter(Boolean).join(' ').toLowerCase();

  if (raw.projectType || raw.projectTypeLabel || raw.contractorFit || Array.isArray(raw.filterTags)) {
    return {
      projectType: raw.projectType || 'general-construction',
      projectTypeLabel: raw.projectTypeLabel || 'General Construction',
      contractorFit: raw.contractorFit || 'medium',
      filterTags: mergeKeywords(raw.filterTags || [], [trade])
    };
  }

  if (/\b(?:comprehensive\s+plan|master\s+plan|planning\s+services?|strategic\s+plan|feasibility\s+study|study\b|assessment\b)\b/i.test(text)) {
    return {
      projectType: 'planning-consulting',
      projectTypeLabel: 'Planning / Consulting',
      contractorFit: 'low',
      filterTags: mergeKeywords(['planning', 'consulting'], [trade])
    };
  }

  if (/\b(?:rfq|request\s+for\s+qualifications?|architectural\s+(?:and|&)\s+engineering|a\s*\/\s*e\b|design\s+(?:services?|team)|engineering\s+services?|consultant|design\s+professional)\b/i.test(text)) {
    return {
      projectType: 'design-services',
      projectTypeLabel: 'Design Services',
      contractorFit: 'low',
      filterTags: mergeKeywords(['design', 'consulting'], [trade])
    };
  }

  return {
    projectType: trade && trade !== 'general' ? `${trade}-work` : 'construction-work',
    projectTypeLabel: trade && trade !== 'general' ? `${trade.charAt(0).toUpperCase()}${trade.slice(1)} Work` : 'Construction Work',
    contractorFit: 'high',
    filterTags: mergeKeywords(['construction'], [trade])
  };
}

function normalizeOpportunity(raw, connector) {
  const title = raw.title || raw.name || raw.projectTitle || 'Untitled Opportunity';
  const sourceUrl = raw.sourceUrl || raw.url || raw.link || connector.sourceUrl || '';
  const postedDate = raw.postedDate || raw.postDate || raw.publishedDate || todayIso();
  const classification = classifyTradeDetails(raw, { fallbackTrade: raw.trade });
  // Trust the classifier's final decision. It already uses raw.trade as a fallback
  // when the keyword evidence is weak, but it can also intentionally override
  // source/category guesses such as BidNet's construction bucket treating road
  // painting / striping as concrete.
  const trade = classification.trade || raw.trade || 'general';
  const projectFilters = inferProjectFilters(raw, trade);

  return {
    id: raw.id || slugify(`${connector.name}-${title}-${postedDate}`),
    title,
    slug: raw.slug || slugify(title),
    state: (raw.state || 'colorado').toLowerCase(),
    city: raw.city || raw.location || 'Colorado',
    county: raw.county || '',
    trade,
    agency: raw.agency || raw.buyer || connector.sourceName || connector.name,
    postedDate,
    dueDate: raw.dueDate || raw.closeDate || raw.closingDate || '',
    ...urgencyFromDueDate(raw.dueDate || raw.closeDate || raw.closingDate || ''),
    estimatedValue: raw.estimatedValue || raw.value || 'Not listed',
    projectType: projectFilters.projectType,
    projectTypeLabel: projectFilters.projectTypeLabel,
    contractorFit: projectFilters.contractorFit,
    filterTags: projectFilters.filterTags,
    summary: raw.summary || raw.description || 'Public construction opportunity harvested by BidSniffer. Replace this placeholder summary with source-specific extraction or AI summarization when available.',
    requirements: Array.isArray(raw.requirements) ? raw.requirements : [],
    sourceName: raw.sourceName || connector.sourceName || connector.name,
    sourceUrl,
    sourceLookupInstructions: raw.sourceLookupInstructions || '',
    sourceLookupSteps: Array.isArray(raw.sourceLookupSteps) ? raw.sourceLookupSteps : [],
    solicitationRef: raw.solicitationRef || raw.docRef || raw.documentReference || '',
    solicitationNumber: raw.solicitationNumber || raw.solicitationId || raw.documentNumber || '',
    buyer: raw.buyer || raw.buyerName || '',
    buyerEmail: raw.buyerEmail || raw.contactEmail || '',
    tradeConfidence: raw.tradeConfidence || classification.confidence,
    matchedTradeKeywords: Array.isArray(raw.matchedTradeKeywords)
      ? raw.matchedTradeKeywords
      : classification.matchedKeywords,
    canonicalKey: raw.canonicalKey || canonicalKey({title, agency: raw.agency || raw.buyer || connector.sourceName || connector.name, dueDate: raw.dueDate || raw.closeDate || raw.closingDate || ''}),
    sourceId: raw.sourceId || '',
    matchKeywords: Array.isArray(raw.matchKeywords)
      ? mergeKeywords(raw.matchKeywords, classification.matchedKeywords)
      : mergeKeywords([trade, raw.city, raw.county, raw.agency], classification.matchedKeywords)
  };
}

function canonicalKey(item) {
  const title = String(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const agency = String(item.agency || '').toLowerCase().trim();
  const dueDate = String(item.dueDate || '').slice(0,10);
  return [title, agency, dueDate].join('|');
}

function dedupeKey(item) {
  return item.id || item.canonicalKey || [
    item.sourceUrl || '',
    String(item.title || '').toLowerCase().trim(),
    item.postedDate || ''
  ].join('|');
}

function mergeOpportunities(existing, incoming, replaceSourceNames = []) {
  const replaceSet = new Set(replaceSourceNames.filter(Boolean));
  const byKey = new Map();

  for (const item of existing) {
    if (replaceSet.has(item.sourceName)) continue;
    byKey.set(dedupeKey(item), item);
  }

  let added = 0;
  let updated = 0;

  for (const item of incoming) {
    const key = dedupeKey(item);
    if (byKey.has(key)) {
      byKey.set(key, { ...byKey.get(key), ...item });
      updated += 1;
    } else {
      byKey.set(key, item);
      added += 1;
    }
  }

  const mergedBeforeCleanup = Array.from(byKey.values());
  const expiredRemoved = mergedBeforeCleanup.filter(isExpiredOpportunity).length;

  const merged = mergedBeforeCleanup
    .filter(item => !isExpiredOpportunity(item))
    .map(item => ({ ...item, ...urgencyFromDueDate(item.dueDate) }))
    .sort((a, b) => String(b.postedDate || '').localeCompare(String(a.postedDate || '')) || String(a.title).localeCompare(String(b.title)));

  return { merged, added, updated, expiredRemoved };
}

async function main() {
  const existing = readJson(SRC_DATA_PATH, []);
  const incoming = [];
  const replaceSourceNames = [];

  console.log(`Loaded ${existing.length} existing opportunities.`);

  for (const connector of connectors) {
    try {
      const rawRecords = await connector.fetchOpportunities();
      const normalized = rawRecords
        .map(raw => normalizeOpportunity(raw, connector))
        .filter(item => item.title && item.sourceUrl);
      incoming.push(...normalized);
      if (connector.replaceExisting) {
        replaceSourceNames.push(connector.sourceName || connector.name);
      }
      console.log(`${connector.name}: ${normalized.length} normalized records.`);
    } catch (err) {
      console.error(`${connector.name}: harvest failed:`, err.message);
      process.exitCode = 1;
    }
  }

  const { merged, added, updated, expiredRemoved } = mergeOpportunities(existing, incoming, replaceSourceNames);
  writeJson(SRC_DATA_PATH, merged);
  writeJson(PUBLIC_DATA_PATH, merged);

  console.log(`Harvest complete. Added: ${added}. Updated: ${updated}. Expired removed: ${expiredRemoved}. Total: ${merged.length}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
