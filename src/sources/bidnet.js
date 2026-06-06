// bidnet source connector
// Harvests public BidNet Direct Colorado construction solicitations.
// The public listing HTML exposes enough normalized teaser data to create
// source-linked opportunity records without credentials or page-generation changes.

const https = require('https');
const { URL } = require('url');
const { classifyTradeDetails } = require('../lib/trade-classifier');

const SOURCE_NAME = 'BidNet Direct';
const BASE_URL = 'https://www.bidnetdirect.com';
const DEFAULT_REGION = 'colorado';
const DEFAULT_STATE = 'colorado';
const DEFAULT_LOCATION_ID = '49';
const DEFAULT_CATEGORY_ID = '320204'; // Construction
const DEFAULT_MAX_PAGES = Number(process.env.BIDNET_MAX_PAGES || 3);
const START_URL = process.env.BIDNET_START_URL || `${BASE_URL}/public/solicitations/open?keywords=&searchContentGroupId=&publishDate=&solSearchStatus=openSolicitationsTab&sortBy=&sortDirection=&pageNumberSelect=1&category=${DEFAULT_CATEGORY_ID}&location=${DEFAULT_LOCATION_ID}`;

function request(url, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'BidSnifferBot/0.1 (+https://bidsniffer.com)'
      }
    }, res => {
      const status = res.statusCode || 0;
      const location = res.headers.location;

      if ([301, 302, 303, 307, 308].includes(status) && location && redirectsRemaining > 0) {
        res.resume();
        request(new URL(location, url).toString(), redirectsRemaining - 1).then(resolve, reject);
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ statusCode: status, body, finalUrl: url }));
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
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(value) {
  return decodeEntities(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
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

function extractDate(block, className) {
  const re = new RegExp(`<span[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>[\\s\\S]*?<span[^>]*class=["'][^"']*dateValue[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`, 'i');
  return mmddyyyyToIso(extractFirst(block, re));
}

function extractAgencyType(block) {
  return decodeEntities(extractFirst(block, /data-mets-tooltip=["']([^"']+)["']/i));
}

function extractNextUrl(html, currentUrl) {
  const next = extractFirst(html, /<link\s+rel=["']next["']\s+href=["']([^"']+)["']/i)
    || extractFirst(html, /<a\b[^>]*href=["']([^"']*\/solicitations\/open-bids\/page\d+[^"']*)["'][^>]*>\s*(?:Next|›|&gt;)/i);
  return next ? absoluteUrl(next, currentUrl || BASE_URL) : '';
}

function parseSolicitationIdFromUrl(url) {
  const path = new URL(url).pathname;
  const ids = path.match(/\/(\d{6,})(?:\?|$|\/)?/g) || [];
  if (ids.length) return ids[ids.length - 1].replace(/\//g, '');
  return extractFirst(url, /searchResultSol_(?:solicitation|notice)_(\d+)/i);
}

function extractListingRows(html, currentUrl = BASE_URL) {
  const rows = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*id=["']searchResultSol_(?:solicitation|notice)_([^"']+)["'][^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*solicitation-link[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRe.exec(html)) !== null) {
    const sourceId = match[1];
    const sourceUrl = absoluteUrl(match[2], currentUrl);
    const block = match[3];
    const title = compactText(extractFirst(block, /<span[^>]*class=["'][^"']*rowTitle[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
    const location = compactText(extractFirst(block, /<span[^>]*class=["'][^"']*location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
    const postedDate = extractDate(block, 'publicationDate');
    const dueDate = extractDate(block, 'closingDate');
    const timeRemaining = compactText(extractFirst(block, /<span[^>]*class=["'][^"']*timeRemaining[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
    const agencyType = extractAgencyType(block);
    const solicitationNumber = parseSolicitationIdFromUrl(sourceUrl) || sourceId;

    if (!title || seen.has(sourceUrl)) continue;
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

function inferCity(row) {
  const title = row.title || '';
  const text = `${title} ${row.sourceUrl}`;
  const cityHints = [
    'Denver', 'Boulder', 'Aurora', 'Greeley', 'Littleton', 'Lakewood', 'Longmont', 'Pueblo', 'Colorado Springs',
    'Fort Collins', 'Grand Junction', 'Loveland', 'Arvada', 'Centennial', 'Thornton', 'Westminster', 'Durango',
    'Englewood', 'Wheat Ridge', 'Golden', 'Commerce City', 'Castle Rock', 'Brighton', 'Pitkin'
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

function mapRowToOpportunity(row) {
  const classification = classifyBidNetTrade(row);
  const trade = classification.trade || 'general';
  const agencyType = row.agencyType || 'BidNet public bid';
  const city = inferCity(row);
  const solicitationNumber = row.solicitationNumber || row.sourceId;

  return {
    id: `bidnet-${row.sourceId || solicitationNumber || slugSafe(row.title)}`,
    title: row.title,
    slug: `${slugSafe(row.title)}-${solicitationNumber}`.replace(/-+$/g, ''),
    state: DEFAULT_STATE,
    city,
    county: '',
    trade,
    agency: agencyType,
    postedDate: row.postedDate,
    dueDate: row.dueDate,
    estimatedValue: 'Not listed',
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

async function fetchPage(url) {
  const response = await request(url);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`BidNet GET failed with status ${response.statusCode} for ${url}`);
  }
  return response;
}

async function fetchOpportunities() {
  const maxPages = Number.isFinite(DEFAULT_MAX_PAGES) && DEFAULT_MAX_PAGES > 0 ? DEFAULT_MAX_PAGES : 3;
  const records = [];
  const visited = new Set();
  let nextUrl = START_URL;

  for (let page = 0; page < maxPages && nextUrl && !visited.has(nextUrl); page += 1) {
    visited.add(nextUrl);
    const response = await fetchPage(nextUrl);
    const rows = extractListingRows(response.body, response.finalUrl);

    if (!rows.length && page === 0) {
      throw new Error('BidNet first page loaded but no solicitation rows were parsed.');
    }

    records.push(...rows.map(mapRowToOpportunity));
    nextUrl = extractNextUrl(response.body, response.finalUrl);
  }

  return records;
}

module.exports = {
  name: 'bidnet',
  sourceName: SOURCE_NAME,
  sourceUrl: START_URL,
  replaceExisting: true,
  fetchOpportunities,
  _test: {
    extractListingRows,
    extractNextUrl,
    mapRowToOpportunity,
    mmddyyyyToIso
  }
};
