// bidnet source connector
// Harvests public BidNet Direct Colorado construction solicitations.
// The public listing HTML exposes enough normalized teaser data to create
// source-linked opportunity records without credentials or page-generation changes.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const { classifyTradeDetails } = require('../lib/trade-classifier');

const SOURCE_NAME = 'BidNet Direct';
const BASE_URL = 'https://www.bidnetdirect.com';
const DEFAULT_REGION = 'colorado';
const DEFAULT_STATE = 'colorado';
const DEFAULT_LOCATION_ID = '49';
const DEFAULT_CATEGORY_ID = '320204'; // Construction
const DEFAULT_MAX_PAGES = Number(process.env.BIDNET_MAX_PAGES || 6);
const START_URL = process.env.BIDNET_START_URL || `${BASE_URL}/public/solicitations/open?keywords=&searchContentGroupId=&publishDate=&solSearchStatus=openSolicitationsTab&sortBy=&sortDirection=&pageNumberSelect=1&category=${DEFAULT_CATEGORY_ID}&location=${DEFAULT_LOCATION_ID}`;

function request(url, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://www.bidnetdirect.com/public/solicitations/open',
        'Upgrade-Insecure-Requests': '1'
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

function extractAttr(tag, name) {
  return extractFirst(tag, new RegExp(`${name}=["']([^"']+)["']`, 'i'));
}

function parseListingAnchor(tag, block, currentUrl, seen) {
  const idAttr = extractAttr(tag, 'id');
  const href = extractAttr(tag, 'href');
  if (!idAttr || !href || !/searchResultSol_(?:solicitation|notice)_/i.test(idAttr)) return null;
  if (!/solicitations\/open-bids/i.test(href)) return null;

  const sourceId = extractFirst(idAttr, /searchResultSol_(?:solicitation|notice)_([^"'\s]+)/i);
  const sourceUrl = absoluteUrl(href, currentUrl);
  if (seen.has(sourceUrl)) return null;

  const title = compactText(extractFirst(block, /<span[^>]*class=["'][^"']*rowTitle[^"']*["'][^>]*>([\s\S]*?)<\/span>/i))
    || compactText(extractFirst(block, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i));
  if (!title) return null;

  seen.add(sourceUrl);
  const location = compactText(extractFirst(block, /<span[^>]*class=["'][^"']*location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
  const postedDate = extractDate(block, 'publicationDate');
  const dueDate = extractDate(block, 'closingDate');
  const timeRemaining = compactText(extractFirst(block, /<span[^>]*class=["'][^"']*timeRemaining[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
  const agencyType = extractAgencyType(block);
  const solicitationNumber = parseSolicitationIdFromUrl(sourceUrl) || sourceId;

  return {
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
  };
}

function extractListingRows(html, currentUrl = BASE_URL) {
  const rows = [];
  const seen = new Set();
  const anchorRe = /<a\b([^>]*\b(?:id|href|class)=["'][^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRe.exec(html)) !== null) {
    const tag = match[0].slice(0, match[0].indexOf('>') + 1);
    const block = match[2];
    const row = parseListingAnchor(tag, block, currentUrl, seen);
    if (row) rows.push(row);
  }

  return rows;
}

function writeDebugHtml(response, reason) {
  if (process.env.BIDNET_DEBUG_HTML !== '1') return;
  try {
    const debugDir = path.join(process.cwd(), '.debug');
    fs.mkdirSync(debugDir, { recursive: true });
    const safeReason = String(reason || 'unknown').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const filePath = path.join(debugDir, `bidnet-${safeReason}.html`);
    fs.writeFileSync(filePath, response.body || '', 'utf8');
    console.warn(`BidNet debug HTML written to ${filePath}`);
  } catch (err) {
    console.warn(`BidNet debug HTML write failed: ${err.message}`);
  }
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


function inferProjectType(row, classification = {}) {
  const text = `${row.title || ''} ${row.rawText || ''}`.toLowerCase();
  const trade = classification.trade || 'general';

  if (/\b(?:comprehensive\s+plan|master\s+plan|planning\s+services?|strategic\s+plan|feasibility\s+study|study\b|assessment\b)\b/i.test(text)) {
    return {
      projectType: 'planning-consulting',
      projectTypeLabel: 'Planning / Consulting',
      contractorFit: 'low',
      filterTags: ['planning', 'consulting']
    };
  }

  if (/\b(?:rfq|request\s+for\s+qualifications?|architectural\s+(?:and|&)\s+engineering|a\s*\/\s*e\b|design\s+(?:services?|team)|engineering\s+services?|consultant|design\s+professional)\b/i.test(text)) {
    return {
      projectType: 'design-services',
      projectTypeLabel: 'Design Services',
      contractorFit: 'low',
      filterTags: ['design', 'consulting']
    };
  }

  if (/\b(?:maintenance|on[-\s]?call|repair|replacement|renovation|remodel|improvements?|upgrade|install(?:ation)?|construction|demolition|paving|roof|concrete|substation|switchgear|sewer|water|trail|park)\b/i.test(text)) {
    return {
      projectType: trade && trade !== 'general' ? `${trade}-work` : 'construction-work',
      projectTypeLabel: trade && trade !== 'general' ? `${trade.charAt(0).toUpperCase()}${trade.slice(1)} Work` : 'Construction Work',
      contractorFit: 'high',
      filterTags: unique(['construction', trade && trade !== 'general' ? trade : 'general'])
    };
  }

  return {
    projectType: 'general-construction',
    projectTypeLabel: 'General Construction',
    contractorFit: 'medium',
    filterTags: ['construction', 'general']
  };
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
    slug: `${slugSafe(row.title)}-${solicitationNumber}`.replace(/-+$/g, ''),
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

async function fetchPage(url) {
  const response = await request(url);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    writeDebugHtml(response, `http-${response.statusCode}`);
    throw new Error(`BidNet GET failed with status ${response.statusCode} for ${url}`);
  }
  return response;
}

async function fetchOpportunities() {
  module.exports.replaceExisting = false;

  const maxPages = Number.isFinite(DEFAULT_MAX_PAGES) && DEFAULT_MAX_PAGES > 0 ? DEFAULT_MAX_PAGES : 6;
  const records = [];
  const visited = new Set();
  let nextUrl = START_URL;

  for (let page = 0; page < maxPages && nextUrl && !visited.has(nextUrl); page += 1) {
    visited.add(nextUrl);
    let response;

    try {
      response = await fetchPage(nextUrl);
    } catch (err) {
      console.warn(`BidNet skipped after request failure: ${err.message}`);
      return records;
    }

    const rows = extractListingRows(response.body, response.finalUrl);

    if (!rows.length) {
      writeDebugHtml(response, page === 0 ? 'no-rows-first-page' : `no-rows-page-${page + 1}`);
      console.warn(`BidNet page ${page + 1} loaded but no solicitation rows were parsed; keeping existing BidNet records.`);
      return records;
    }

    records.push(...rows.map(mapRowToOpportunity));
    nextUrl = extractNextUrl(response.body, response.finalUrl);
  }

  if (records.length > 0) {
    module.exports.replaceExisting = true;
  }

  return records;
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
    mapRowToOpportunity,
    mmddyyyyToIso
  }
};
