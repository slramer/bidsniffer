const fs = require('fs');
const path = require('path');
const { classifyTradeDetails } = require('../lib/trade-classifier');

const connectors = [
  require('../sources/colorado-vss'),
  require('../sources/cdot'),
  require('../sources/denver'),
  require('../sources/boulder-county'),
  require('../sources/bidnet'),
  require('../sources/planetbids'),
  require('../sources/colorado-bid-network'),
  require('../sources/opengov'),
  require('../sources/civicengage'),
  require('../sources/school-districts'),
  require('../sources/public-agency-pages')
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
    lastSeenAt: new Date().toISOString(),
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

function normalizeDedupeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(?:request\s+for\s+(?:proposals?|bids?|quotes?|qualifications?|information)|invitation\s+for\s+bids?|documented\s+quote)\b:?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:rfp|rfq|ifb|bid|bids|quote|solicitation|project|construction)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function primaryDedupeKey(item) {
  return item.id || item.canonicalKey || [
    item.sourceUrl || '',
    String(item.title || '').toLowerCase().trim(),
    item.postedDate || ''
  ].join('|');
}

function contentDedupeKey(item) {
  const title = normalizeDedupeText(item.title);
  const dueDate = String(item.dueDate || '').slice(0, 10);

  // Avoid merging vague records like "Roof Replacement" or "Concrete Services"
  // across unrelated agencies. This secondary key is meant to catch the common
  // cross-source duplicate case where BidNet, VSS, Denver, etc. publish the
  // same named opportunity with the same due date.
  if (!title || !dueDate) return '';

  const words = title.split(/\s+/).filter(Boolean);
  if (title.length < 10 || words.length < 2) return '';

  return `content:${title}|${dueDate}`;
}

function mergeArrays(...groups) {
  return Array.from(new Set(groups.flat().filter(Boolean)));
}

function sourceQualityScore(item = {}) {
  let score = 0;
  if (item.buyerEmail) score += 8;
  if (item.buyer) score += 4;
  if (item.solicitationNumber) score += 3;
  if (item.sourceLookupInstructions) score += 2;
  if (Array.isArray(item.sourceLookupSteps) && item.sourceLookupSteps.length) score += 2;
  if (Array.isArray(item.requirements) && item.requirements.length) score += 2;
  if (String(item.sourceName || '').toLowerCase().includes('bidnet')) score -= 3;
  return score;
}

function mergeOpportunityRecords(a, b) {
  const preferred = sourceQualityScore(b) >= sourceQualityScore(a) ? b : a;
  const fallback = preferred === b ? a : b;

  return {
    ...fallback,
    ...preferred,
    requirements: mergeArrays(fallback.requirements || [], preferred.requirements || []),
    sourceLookupSteps: mergeArrays(fallback.sourceLookupSteps || [], preferred.sourceLookupSteps || []),
    matchedTradeKeywords: mergeKeywords(fallback.matchedTradeKeywords || [], preferred.matchedTradeKeywords || []),
    matchKeywords: mergeKeywords(fallback.matchKeywords || [], preferred.matchKeywords || []),
    buyer: preferred.buyer || fallback.buyer || '',
    buyerEmail: preferred.buyerEmail || fallback.buyerEmail || '',
    sourceId: preferred.sourceId || fallback.sourceId || '',
    sourceUrl: preferred.sourceUrl || fallback.sourceUrl || '',
    solicitationRef: preferred.solicitationRef || fallback.solicitationRef || '',
    solicitationNumber: preferred.solicitationNumber || fallback.solicitationNumber || '',
    lastSeenAt: [fallback.lastSeenAt, preferred.lastSeenAt].filter(Boolean).sort().pop() || new Date().toISOString()
  };
}

function mergeOpportunities(existing, incoming, replaceSourceNames = []) {
  const replaceSet = new Set(replaceSourceNames.filter(Boolean));
  const records = [];
  const byPrimaryKey = new Map();
  const byContentKey = new Map();

  function indexRecord(index, item) {
    byPrimaryKey.set(primaryDedupeKey(item), index);
    const secondaryKey = contentDedupeKey(item);
    if (secondaryKey) byContentKey.set(secondaryKey, index);
  }

  function findDuplicateIndex(item) {
    const primaryKey = primaryDedupeKey(item);
    const secondaryKey = contentDedupeKey(item);
    if (byPrimaryKey.has(primaryKey)) return byPrimaryKey.get(primaryKey);
    if (secondaryKey && byContentKey.has(secondaryKey)) return byContentKey.get(secondaryKey);
    return -1;
  }

  for (const item of existing) {
    if (replaceSet.has(item.sourceName)) continue;

    const duplicateIndex = findDuplicateIndex(item);
    if (duplicateIndex >= 0) {
      records[duplicateIndex] = mergeOpportunityRecords(records[duplicateIndex], item);
      indexRecord(duplicateIndex, records[duplicateIndex]);
    } else {
      const index = records.length;
      records.push(item);
      indexRecord(index, item);
    }
  }

  const existingAfterCleanup = records.length;
  let added = 0;
  let updated = 0;

  for (const item of incoming) {
    const duplicateIndex = findDuplicateIndex(item);
    if (duplicateIndex >= 0) {
      records[duplicateIndex] = mergeOpportunityRecords(records[duplicateIndex], item);
      indexRecord(duplicateIndex, records[duplicateIndex]);
      updated += 1;
    } else {
      const index = records.length;
      records.push(item);
      indexRecord(index, item);
      added += 1;
    }
  }

  const mergedBeforeCleanup = records;
  const expiredRemoved = mergedBeforeCleanup.filter(isExpiredOpportunity).length;

  const merged = mergedBeforeCleanup
    .filter(item => !isExpiredOpportunity(item))
    .map(item => ({ ...item, ...urgencyFromDueDate(item.dueDate) }))
    .sort((a, b) => String(b.postedDate || '').localeCompare(String(a.postedDate || '')) || String(a.title).localeCompare(String(b.title)));

  return { merged, added, updated, expiredRemoved, existingDeduped: existing.length - existingAfterCleanup };
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

  const { merged, added, updated, expiredRemoved, existingDeduped } = mergeOpportunities(existing, incoming, replaceSourceNames);
  writeJson(SRC_DATA_PATH, merged);
  writeJson(PUBLIC_DATA_PATH, merged);

  console.log(`Harvest complete. Added: ${added}. Updated: ${updated}. Existing duplicates collapsed: ${existingDeduped}. Expired removed: ${expiredRemoved}. Total: ${merged.length}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
