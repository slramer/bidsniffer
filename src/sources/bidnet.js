// BidNet Direct source connector
// Harvests public BidNet Direct Colorado construction solicitations.
// Keep this connector intentionally boring: parse the public listing table,
// follow BidNet's own rel="next" link, and never wipe existing data on a bad run.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const { classifyTradeDetails } = require('../lib/trade-classifier');

const SOURCE_NAME = 'BidNet Direct';
const BASE_URL = 'https://www.bidnetdirect.com';
const DEFAULT_STATE = 'colorado';
const DEFAULT_LOCATION_ID = '49'; // Colorado
const DEFAULT_CATEGORY_ID = '320204'; // Construction
const DEFAULT_MAX_PAGES = Number(process.env.BIDNET_MAX_PAGES || 6);
const DEFAULT_PAGE_DELAY_MS = Number(process.env.BIDNET_PAGE_DELAY_MS || 750);
function bidnetSearchUrl({ keywords = '', category = '', page = 1 } = {}) {
  const params = new URLSearchParams({
    keywords,
    searchContentGroupId: '',
    publishDate: '',
    solSearchStatus: 'openSolicitationsTab',
    sortBy: '',
    sortDirection: '',
    pageNumberSelect: String(page),
    location: DEFAULT_LOCATION_ID
  });
  if (category) params.set('category', category);
  return `${BASE_URL}/public/solicitations/open?${params.toString()}`;
}

const BIDNET_CATEGORY_SEARCHES = [
  {
    name: 'construction',
    category: '320204'
  },
  {
    name: 'utilities',
    category: '320179'
  }
];

function defaultStartUrls() {
  if (process.env.BIDNET_START_URLS) {
    return process.env.BIDNET_START_URLS
      .split(/\s*[,\n]\s*/)
      .map(value => value.trim())
      .filter(Boolean);
  }

  if (process.env.BIDNET_START_URL) {
    return [process.env.BIDNET_START_URL];
  }

  return BIDNET_CATEGORY_SEARCHES.map(search =>
    bidnetSearchUrl({
      category: search.category
    })
  );
}

const START_URLS = defaultStartUrls();
const START_URL = START_URLS[0];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function request(url, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(parsed, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache',
        'Referer': 'https://www.bidnetdirect.com/solicitations/open-bids',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0'
      }
    }, res => {
      const status = res.statusCode || 0;
      const location = res.headers.location;

      if ([301, 302, 303, 307, 308].includes(status) && location && redirectsRemaining > 0) {
        res.resume();
        request(new URL(location, parsed).toString(), redirectsRemaining - 1).then(resolve, reject);
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: status, body, finalUrl: parsed.toString() }));
    });

    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`Request timed out for ${url}`)));
    req.end();
  });
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&iquest;/gi, '¿')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(value) {
  return decodeEntities(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|td|span)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactText(value) {
  return stripHtml(value).replace(/\s+/g, ' ').trim();
}

function slugSafe(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'untitled-opportunity';
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function mmddyyyyToIso(value) {
  const match = String(value || '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!match) return '';
  return `${match[3]}-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function absoluteUrl(href, base = BASE_URL) {
  return new URL(decodeEntities(href), base).toString();
}

function extractFirst(value, regex) {
  const match = String(value || '').match(regex);
  return match ? match[1].trim() : '';
}

function attrValue(tag, attrName) {
  const re = new RegExp(`${attrName}=["']([^"']+)["']`, 'i');
  return extractFirst(tag, re);
}

function extractDate(block, className) {
  const classMatch = new RegExp(`<span[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>`, 'i').exec(block);
  if (!classMatch) return '';
  const section = block.slice(classMatch.index, classMatch.index + 1500);
  return mmddyyyyToIso(extractFirst(section, /<span[^>]*class=["'][^"']*dateValue[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
}

function extractAgencyType(block) {
  return decodeEntities(extractFirst(block, /data-mets-tooltip=["']([^"']+)["']/i));
}

function extractNextUrl(html, currentUrl) {
  const next = extractFirst(html, /<link\b[^>]*rel=["']next["'][^>]*href=["']([^"']+)["'][^>]*>/i)
    || extractFirst(html, /<a\b[^>]*href=["']([^"']*\/solicitations\/open-bids\/page\d+[^"']*)["'][^>]*>\s*(?:Next|›|&gt;)/i);
  return next ? absoluteUrl(next, currentUrl || BASE_URL) : '';
}

function parseSolicitationIdFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ids = pathname.match(/\/(\d{6,})(?:\?|$|\/)?/g) || [];
    if (ids.length) return ids[ids.length - 1].replace(/\//g, '');
  } catch (err) {
    // Ignore malformed URLs and fall through to regex fallback.
  }
  return extractFirst(url, /searchResultSol_(?:solicitation|notice)_(\d+)/i);
}

function extractRowsFromTable(html) {
  const table = extractFirst(html, /<table\b[^>]*id=["']solicitationsList["'][^>]*>([\s\S]*?)<\/table>/i);
  const body = extractFirst(table || html, /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i) || table || html;
  const rows = [];
  const rowRe = /<tr\b[^>]*data-index=["']?\d+["']?[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRe.exec(body)) !== null) rows.push(match[0]);
  return rows;
}

function extractListingRows(html, currentUrl = BASE_URL) {
  const rows = [];
  const seen = new Set();

  for (const rowHtml of extractRowsFromTable(html)) {
    const anchorMatch = rowHtml.match(/<a\b([^>]*\bclass=["'][^"']*solicitation-link[^"']*["'][^>]*)>([\s\S]*?)<\/a>/i)
      || rowHtml.match(/<a\b([^>]*\bid=["']searchResultSol_(?:solicitation|notice)_\d+["'][^>]*)>([\s\S]*?)<\/a>/i);
    if (!anchorMatch) continue;

    const anchorAttrs = anchorMatch[1];
    const block = anchorMatch[2];
    const href = attrValue(anchorAttrs, 'href');
    const anchorId = attrValue(anchorAttrs, 'id');
    const sourceId = extractFirst(anchorId, /searchResultSol_(?:solicitation|notice)_([0-9]+)/i) || parseSolicitationIdFromUrl(href);
    const sourceUrl = href ? absoluteUrl(href, currentUrl) : '';
    const title = compactText(extractFirst(block, /<span[^>]*class=["'][^"']*rowTitle[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
    const location = compactText(extractFirst(block, /<span[^>]*class=["'][^"']*location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
    const postedDate = extractDate(block, 'publicationDate');
    const dueDate = extractDate(block, 'closingDate');
    const timeRemaining = compactText(extractFirst(block, /<span[^>]*class=["'][^"']*timeRemaining[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
    const agencyType = extractAgencyType(block);
    const solicitationNumber = parseSolicitationIdFromUrl(sourceUrl) || sourceId;

    if (!title || !sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);

    rows.push({
      sourceId,
      sourceUrl,
      title,
      location: location || 'Colorado',
      postedDate: postedDate || todayIso(),
      dueDate,
      timeRemaining,
      agencyType,
      solicitationNumber,
      rawText: compactText(block)
    });
  }

  return rows;
}

function extractResultCount(html) {
  const raw = extractFirst(html, /<span[^>]*class=["'][^"']*simpleSolResultsNumResults[^"']*["'][^>]*>\s*([\d,]+)\s+results/i)
    || extractFirst(html, /\(([\d,]+)\s+results\)/i);
  return raw ? Number(raw.replace(/,/g, '')) : 0;
}

function inferCity(row) {
  const text = `${row.title || ''} ${row.sourceUrl || ''}`;
  const cityHints = [
    'Denver', 'Boulder', 'Aurora', 'Greeley', 'Littleton', 'Lakewood', 'Longmont', 'Pueblo', 'Colorado Springs',
    'Fort Collins', 'Grand Junction', 'Loveland', 'Arvada', 'Centennial', 'Thornton', 'Westminster', 'Durango',
    'Englewood', 'Wheat Ridge', 'Golden', 'Commerce City', 'Castle Rock', 'Brighton', 'Pitkin', 'Gunnison'
  ];
  return cityHints.find(city => new RegExp(`\\b${city.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text)) || row.location || 'Colorado';
}

function classifyBidNetTrade(row) {
  return classifyTradeDetails({
    title: row.title,
    summary: row.rawText,
    description: row.rawText,
    sourceName: SOURCE_NAME,
    agency: SOURCE_NAME
  });
}

function inferProjectType(row, classification = {}) {
  const text = `${row.title || ''} ${row.rawText || ''}`.toLowerCase();
  const trade = classification.trade || 'general';

  if (/\b(?:comprehensive\s+plan|master\s+plan|planning\s+services?|strategic\s+plan|feasibility\s+study|study\b|assessment\b)\b/i.test(text)) {
    return { projectType: 'planning-consulting', projectTypeLabel: 'Planning / Consulting', contractorFit: 'low', filterTags: ['planning', 'consulting'] };
  }

  if (/\b(?:rfq|request\s+for\s+qualifications?|architectural\s+(?:and|&)\s+engineering|a\s*\/\s*e\b|design\s+(?:services?|team)|engineering\s+services?|consultant|design\s+professional)\b/i.test(text)) {
    return { projectType: 'design-services', projectTypeLabel: 'Design Services', contractorFit: 'low', filterTags: ['design', 'consulting'] };
  }

  if (/\b(?:maintenance|on[-\s]?call|repair|replacement|renovation|remodel|improvements?|upgrade|install(?:ation)?|construction|demolition|paving|roof|concrete|substation|switchgear|sewer|water|trail|park|ramp|turf|airport)\b/i.test(text)) {
    return {
      projectType: trade && trade !== 'general' ? `${trade}-work` : 'construction-work',
      projectTypeLabel: trade && trade !== 'general' ? `${trade.charAt(0).toUpperCase()}${trade.slice(1)} Work` : 'Construction Work',
      contractorFit: 'high',
      filterTags: unique(['construction', trade && trade !== 'general' ? trade : 'general'])
    };
  }

  return { projectType: 'general-construction', projectTypeLabel: 'General Construction', contractorFit: 'medium', filterTags: ['construction', 'general'] };
}

function mapRowToOpportunity(row) {
  const classification = classifyBidNetTrade(row);
  const trade = classification.trade || 'general';
  const agencyType = row.agencyType || 'BidNet public bid';
  const projectMeta = inferProjectType(row, classification);
  const city = inferCity(row);
  const solicitationNumber = row.solicitationNumber || row.sourceId;

  return {
    id: `bidnet-${row.sourceId || solicitationNumber || slugSafe(row.title)}`,
    title: row.title,
    slug: `${slugSafe(row.title)}-${solicitationNumber || ''}`.replace(/-+$/g, ''),
    state: DEFAULT_STATE,
    city,
    county: '',
    trade,
    agency: agencyType,
    postedDate: row.postedDate,
    dueDate: row.dueDate,
    estimatedValue: 'Not listed',
    projectType: projectMeta.projectType,
    projectTypeLabel: projectMeta.projectTypeLabel,
    contractorFit: projectMeta.contractorFit,
    filterTags: unique([...(projectMeta.filterTags || []), trade, agencyType]),
    summary: `${row.title}. ${agencyType} listed on BidNet Direct for ${row.location || 'Colorado'} construction opportunities.`,
    requirements: unique([
      agencyType ? `BidNet category: ${agencyType}` : '',
      row.postedDate ? `Published: ${row.postedDate}` : '',
      row.dueDate ? `Closing: ${row.dueDate}` : '',
      row.timeRemaining ? `Time remaining: ${row.timeRemaining}` : '',
      solicitationNumber ? `BidNet reference: ${solicitationNumber}` : ''
    ]),
    sourceName: SOURCE_NAME,
    sourceUrl: row.sourceUrl,
    sourceLookupInstructions: solicitationNumber
      ? `Open BidNet Direct and use the direct source link, or search BidNet for reference ${solicitationNumber}.`
      : 'Open the BidNet Direct source link for this solicitation.',
    sourceLookupSteps: [
      'Open BidNet Direct open solicitations.',
      'Filter to Colorado and Construction if needed.',
      solicitationNumber ? `Search or locate reference ${solicitationNumber}.` : `Search for ${row.title}.`,
      'Open the matching solicitation record.'
    ],
    solicitationRef: solicitationNumber,
    solicitationNumber,
    buyer: '',
    buyerEmail: '',
    tradeConfidence: classification.confidence,
    matchedTradeKeywords: classification.matchedKeywords,
    sourceId: row.sourceId,
    canonicalKey: [row.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), agencyType.toLowerCase(), row.dueDate || ''].join('|'),
    matchKeywords: unique([
      trade,
      'bidnet',
      'colorado',
      city,
      agencyType,
      solicitationNumber,
      ...classification.matchedKeywords
    ].map(value => String(value || '').toLowerCase()))
  };
}

function writeDebugHtml(pageLabel, html) {
  if (!process.env.BIDNET_DEBUG_HTML) return;
  const dir = path.join(process.cwd(), '.debug');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `bidnet-${pageLabel}.html`), html);
}

async function fetchPage(url, pageLabel) {
  const response = await request(url);
  writeDebugHtml(pageLabel, response.body);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`BidNet GET failed with status ${response.statusCode} for ${url}`);
  }
  return response;
}

async function harvestStartUrl(startUrl, maxPages) {
  const records = [];
  const visited = new Set();
  let nextUrl = startUrl;
  let expectedCount = 0;

  for (let page = 1; page <= maxPages && nextUrl && !visited.has(nextUrl); page += 1) {
    visited.add(nextUrl);
    if (page > 1) await sleep(DEFAULT_PAGE_DELAY_MS);

    const response = await fetchPage(nextUrl, `page-${page}-${Math.abs(hashString(startUrl))}`);
    const rows = extractListingRows(response.body, response.finalUrl);

    if (page === 1) expectedCount = extractResultCount(response.body);

    if (!rows.length) {
      const message = page === 1
        ? `BidNet first page loaded but no solicitation rows were parsed for ${startUrl}; skipping this BidNet search.`
        : `BidNet page ${page} loaded but no solicitation rows were parsed; stopping BidNet pagination for ${startUrl}.`;
      console.warn(message);
      break;
    }

    records.push(...rows.map(mapRowToOpportunity));
    nextUrl = extractNextUrl(response.body, response.finalUrl);
  }

  if (expectedCount && records.length && records.length < Math.min(expectedCount, maxPages * 20)) {
    console.warn(`BidNet harvested ${records.length} of ${expectedCount} listed results for ${startUrl}. Pagination may have stopped early.`);
  }

  return records;
}

function hashString(value) {
  let hash = 0;
  for (const char of String(value || '')) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }
  return hash;
}

async function fetchOpportunities() {
  const maxPages = Number.isFinite(DEFAULT_MAX_PAGES) && DEFAULT_MAX_PAGES > 0 ? DEFAULT_MAX_PAGES : 6;
  const allRecords = [];
  const seenIds = new Set();

  for (const startUrl of START_URLS) {
    if (allRecords.length) await sleep(DEFAULT_PAGE_DELAY_MS);
    const records = await harvestStartUrl(startUrl, maxPages);
    console.log(`bidnet search: ${records.length} raw records from ${startUrl}`);

    for (const record of records) {
      const key = record.sourceId || record.sourceUrl || record.canonicalKey || record.title;
      if (!key || seenIds.has(key)) continue;
      seenIds.add(key);
      allRecords.push(record);
    }
  }

  return allRecords;
}

module.exports = {
  name: 'bidnet',
  sourceName: SOURCE_NAME,
  sourceUrl: START_URL,
  replaceExisting: false,
  fetchOpportunities,
  _test: {
    extractListingRows,
    extractNextUrl,
    extractResultCount,
    mapRowToOpportunity,
    mmddyyyyToIso
  }
};
