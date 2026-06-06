// colorado-bid-network source connector
// Harvests public Colorado Bid Network agency listing pages.
// This is an aggregator/discovery source. Bid package documents usually live on
// the owner portal or BidNet outside links, so sourceLookupSteps point the user
// back to the Colorado Bid Network record first and then to the owner/outside link.

const https = require('https');
const { URL } = require('url');
const { classifyTradeDetails } = require('../lib/trade-classifier');

const SOURCE_NAME = 'Colorado Bid Network';
const BASE_URL = 'https://www.coloradobids.net';
const DEFAULT_START_URLS = [
  'https://www.coloradobids.net/government-agencies/arapahoe/arapahoe-county-816221/'
];
const START_URLS = (process.env.COLORADO_BID_NETWORK_URLS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const MAX_RECORDS_PER_PAGE = Number(process.env.COLORADO_BID_NETWORK_MAX_RECORDS || 25);
const FETCH_DETAILS = process.env.COLORADO_BID_NETWORK_FETCH_DETAILS !== 'false';
const DETAIL_DELAY_MS = Number(process.env.COLORADO_BID_NETWORK_DETAIL_DELAY_MS || 350);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function request(url, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(parsed, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'close',
        'Pragma': 'no-cache',
        'User-Agent': 'Mozilla/5.0 (compatible; BidSnifferBot/0.1; +https://bidsniffer.com)'
      }
    }, res => {
      const status = res.statusCode || 0;
      const location = res.headers.location;

      if ([301, 302, 303, 307, 308].includes(status) && location && redirectsRemaining > 0) {
        res.resume();
        request(new URL(location, url).toString(), redirectsRemaining - 1).then(resolve, reject);
        return;
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: status, body: data, finalUrl: url }));
    });

    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`Request timed out for ${url}`)));
    req.end();
  });
}

function decodeEntities(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, '-')
    .replace(/&mdash;|&#8212;/gi, '-')
    .replace(/&rsquo;|&#8217;/gi, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(value = '') {
  return decodeEntities(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|td|th|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactText(value = '') {
  return stripHtml(value).replace(/\s+/g, ' ').trim();
}

function slugSafe(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'untitled-opportunity';
}

function parseDateToIso(value = '') {
  const clean = String(value || '').trim();
  if (!clean) return '';

  const mdy = clean.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    let year = Number(mdy[3]);
    if (year < 100) year += 2000;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }

  const parsed = Date.parse(clean);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10);
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(decodeEntities(href || ''), baseUrl || BASE_URL).toString();
  } catch (_) {
    return '';
  }
}

function extractAgencyFromPage(html = '') {
  const heading = compactText((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
  const agency = heading.replace(/\s+Bids,?\s+RFPs,?\s+RFQs.*$/i, '').trim();
  return agency || '';
}

function extractBreadcrumbCounty(html = '') {
  const breadcrumb = compactText((html.match(/Colorado\s*»[\s\S]*?<h1/i) || [])[0] || '');
  const match = breadcrumb.match(/Colorado\s*»\s*([^»]+?)\s*»/i);
  return match ? match[1].trim() : '';
}

function parseListingRows(html, pageUrl) {
  const records = [];
  const agency = extractAgencyFromPage(html);
  const county = extractBreadcrumbCounty(html);
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const cells = Array.from(rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map(cell => cell[1]);
    if (cells.length < 2) continue;

    const dueDate = parseDateToIso(compactText(cells[0]));
    const linkMatch = cells[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!dueDate || !linkMatch) continue;

    const sourceUrl = absoluteUrl(linkMatch[1], pageUrl);
    if (!/\.html(?:$|[?#])/i.test(sourceUrl)) continue;

    const title = compactText(linkMatch[2]);
    const titleCellText = compactText(cells[1]);
    const combined = cells.map(compactText).join(' ');
    const scope = (titleCellText.match(/\bScope:\s*([\s\S]*?)$/i) || [])[1] || '';
    const location = compactText(cells[2] || '') || (combined.match(/\bLocation:\s*([^\n]+?)(?:\s+Scope:|$)/i) || [])[1] || '';

    records.push(buildListingRecord({ title, dueDate, scope, location, sourceUrl, agency, county }));
  }

  return records.length ? records : parseListingFallback(html, pageUrl, agency, county);
}

function parseListingFallback(html, pageUrl, agency, county) {
  const records = [];
  const mainHtml = html.split(/<h[1-3][^>]*>\s*Bids in Colorado/i)[0] || html;
  const pattern = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*<a\b[^>]*href=["']([^"']+\.html)["'][^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=\d{1,2}\/\d{1,2}\/\d{2,4}\s*<a\b|<h[1-3][^>]*>|$)/gi;
  let match;

  while ((match = pattern.exec(mainHtml)) !== null) {
    const dueDate = parseDateToIso(match[1]);
    const sourceUrl = absoluteUrl(match[2], pageUrl);
    const title = compactText(match[3]);
    const rest = compactText(match[4]);
    const scope = (rest.match(/\bScope:\s*([\s\S]*?)(?:\s+(?:Notes|Plans|Bond|Owner|Buyer|Status):|$)/i) || [])[1] || '';
    const location = rest.replace(/\bScope:[\s\S]*$/i, '').trim();

    records.push(buildListingRecord({ title, dueDate, scope, location, sourceUrl, agency, county }));
  }

  return records;
}

function buildListingRecord({ title, dueDate, scope, location, sourceUrl, agency, county }) {
  const reportId = (sourceUrl.match(/\/(\d+)-[^/]+\.html/i) || [])[1] || '';
  const summaryScope = compactText(scope);
  const titleClean = title.replace(/^\*UPDATED\*\s*/i, '').trim();
  const tradeClassification = classifyTradeDetails({ title: titleClean, scope: summaryScope, location, agency });

  return {
    id: `colorado-bid-network-${reportId || slugSafe(`${agency}-${titleClean}-${dueDate}`)}`,
    title: titleClean,
    state: 'colorado',
    city: location || 'Colorado',
    county,
    trade: tradeClassification.trade,
    agency: agency || SOURCE_NAME,
    postedDate: '',
    dueDate,
    estimatedValue: 'Not listed',
    summary: summaryScope || `${titleClean}. Colorado Bid Network listing from ${agency || 'a Colorado public agency'}.`,
    requirements: [
      reportId ? `Colorado Bid Network report: ${reportId}` : '',
      location ? `Location: ${location}` : '',
      summaryScope ? `Scope: ${summaryScope}` : ''
    ].filter(Boolean),
    sourceName: SOURCE_NAME,
    sourceUrl,
    solicitationRef: reportId,
    solicitationNumber: '',
    buyer: agency || '',
    buyerEmail: '',
    sourceId: reportId,
    sourceLookupInstructions: `Open the Colorado Bid Network listing for ${titleClean}. Use any Outside Link on that record for the official bid package or owner portal.`,
    sourceLookupSteps: [
      'Open the Colorado Bid Network source record.',
      'Review the listed scope, location, due date, owner, and contact fields.',
      'Use the Outside Link or owner website shown on the record to reach the official bid package.',
      'Confirm current status and addenda on the official owner/BidNet page before bidding.'
    ],
    tradeConfidence: tradeClassification.confidence,
    matchedTradeKeywords: tradeClassification.matchedKeywords,
    matchKeywords: [
      'colorado bid network',
      agency,
      county,
      location,
      tradeClassification.trade,
      ...tradeClassification.matchedKeywords
    ].filter(Boolean).map(value => String(value).toLowerCase()),
    canonicalKey: `${titleClean.toLowerCase()}|${(agency || SOURCE_NAME).toLowerCase()}|${dueDate}`
  };
}

function fieldFromText(text, label) {
  const labels = 'Bid Date & Time|Prebid|Solicitation Title|Owner Solic Number|Status|Report|Country|State|County|Location|Scope|Notes|Plans|Outside Link|Bond|Update Notes|Owner Type|Buyer|Address|City|TEL|Website|Contact|Bid Pkg Source';
  const pattern = new RegExp(`\\b${label}\\s*:\\s*([\\s\\S]*?)(?=\\s+(?:${labels})\\s*:\u0020*|\\s+Login to view|$)`, 'i');
  const match = text.match(pattern);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function outsideLinkFromHtml(html, pageUrl) {
  const idx = html.search(/Outside Link:/i);
  if (idx === -1) return '';
  const chunk = html.slice(idx, idx + 1000);
  const link = chunk.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  return link ? absoluteUrl(link[1].replace(/\s+/g, ''), pageUrl) : '';
}

function parseDetailPage(html, pageUrl, listingRecord = {}) {
  const text = compactText(html.split(/Bids in Colorado \| Colorado Bid Network provides/i)[0] || html);
  const h1 = compactText((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
  const title = fieldFromText(text, 'Solicitation Title').replace(/^\*UPDATED\*\s*/i, '').trim() || h1 || listingRecord.title;
  const dueDate = parseDateToIso(fieldFromText(text, 'Bid Date & Time')) || listingRecord.dueDate || '';
  const county = fieldFromText(text, 'County') || listingRecord.county || '';
  const location = fieldFromText(text, 'Location') || listingRecord.city || 'Colorado';
  const scope = fieldFromText(text, 'Scope') || listingRecord.summary || '';
  const notes = fieldFromText(text, 'Notes');
  const plans = fieldFromText(text, 'Plans');
  const bond = fieldFromText(text, 'Bond');
  const reportId = fieldFromText(text, 'Report') || listingRecord.sourceId || '';
  const solicitationNumber = fieldFromText(text, 'Owner Solic Number');
  const buyer = fieldFromText(text, 'Buyer') || listingRecord.agency || '';
  const contact = fieldFromText(text, 'Contact');
  const outsideLink = outsideLinkFromHtml(html, pageUrl);
  const tradeClassification = classifyTradeDetails({ title, scope, notes, plans, location, buyer });

  return {
    ...listingRecord,
    id: `colorado-bid-network-${reportId || slugSafe(`${buyer}-${title}-${dueDate}`)}`,
    title,
    city: location,
    county,
    trade: tradeClassification.trade,
    agency: buyer || listingRecord.agency || SOURCE_NAME,
    dueDate,
    summary: [scope, notes ? `Notes: ${notes}` : '', plans ? `Plans: ${plans}` : ''].filter(Boolean).join(' '),
    requirements: [
      reportId ? `Colorado Bid Network report: ${reportId}` : '',
      solicitationNumber ? `Owner solicitation number: ${solicitationNumber}` : '',
      location ? `Location: ${location}` : '',
      bond ? `Bond: ${bond}` : '',
      contact ? `Contact: ${contact}` : '',
      outsideLink ? `Outside link: ${outsideLink}` : ''
    ].filter(Boolean),
    sourceUrl: pageUrl,
    solicitationRef: reportId,
    solicitationNumber,
    buyer: contact || buyer,
    sourceId: reportId,
    tradeConfidence: tradeClassification.confidence,
    matchedTradeKeywords: tradeClassification.matchedKeywords,
    sourceLookupInstructions: outsideLink
      ? `Open the Colorado Bid Network listing, then use its Outside Link for the official bid package: ${outsideLink}`
      : `Open the Colorado Bid Network listing for ${title}, then use the owner/contact fields to confirm the official bid package.`,
    sourceLookupSteps: [
      'Open the Colorado Bid Network source record.',
      outsideLink ? 'Click the Outside Link shown on the record.' : 'Review the owner website/contact fields shown on the record.',
      'Confirm current status, addenda, bid documents, and deadlines on the official owner/BidNet page before bidding.'
    ],
    matchKeywords: [
      'colorado bid network',
      buyer,
      contact,
      county,
      location,
      solicitationNumber,
      tradeClassification.trade,
      ...tradeClassification.matchedKeywords
    ].filter(Boolean).map(value => String(value).toLowerCase()),
    canonicalKey: `${title.toLowerCase()}|${(buyer || SOURCE_NAME).toLowerCase()}|${dueDate}`
  };
}

async function fetchDetail(record) {
  const response = await request(record.sourceUrl);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`detail request failed with status ${response.statusCode} for ${record.sourceUrl}`);
  }
  return parseDetailPage(response.body, response.finalUrl || record.sourceUrl, record);
}

async function fetchOpportunities() {
  const startUrls = START_URLS.length ? START_URLS : DEFAULT_START_URLS;
  const records = [];

  for (const startUrl of startUrls) {
    const response = await request(startUrl);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Colorado Bid Network listing request failed with status ${response.statusCode} for ${startUrl}`);
    }

    const listingRecords = parseListingRows(response.body, response.finalUrl || startUrl)
      .slice(0, MAX_RECORDS_PER_PAGE);

    if (!FETCH_DETAILS) {
      records.push(...listingRecords);
      continue;
    }

    for (const record of listingRecords) {
      try {
        if (records.length) await sleep(DETAIL_DELAY_MS);
        records.push(await fetchDetail(record));
      } catch (err) {
        console.warn(`${SOURCE_NAME}: using listing-only record for ${record.title}: ${err.message}`);
        records.push(record);
      }
    }
  }

  return records;
}

module.exports = {
  name: 'colorado-bid-network',
  sourceName: SOURCE_NAME,
  sourceUrl: BASE_URL,
  fetchOpportunities,
  parseListingRows,
  parseDetailPage
};
