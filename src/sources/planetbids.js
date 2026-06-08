// PlanetBids source connector
//
// Harvests public PlanetBids / VendorLine bid-search pages. PlanetBids does
// not appear to advertise a stable free public API, but the public bo-search
// pages expose the active opportunity list in HTML that is safe to parse
// without login/captcha/browser automation.
//
// Add portals as they are verified. Keep this connector platform-based so new
// agencies are config entries, not one-off scrapers.

const https = require('https');
const { URL } = require('url');

const SOURCE_NAME = 'PlanetBids Public Vendor Portal';

const { VERIFIED_PLANETBIDS_PORTALS } = require('./planetbids-portals');

// Only verified Colorado portals are harvested. Candidates live in
// planetbids-portals.js but are intentionally not enabled until the verifier
// proves they are real Colorado agencies with readable public opportunities.
const PORTALS = VERIFIED_PLANETBIDS_PORTALS;

function portalSearchUrl(portal) {
  const host = portal.host || 'vendors.planetbids.com';
  return `https://${host}/portal/${encodeURIComponent(portal.portalId)}/bo/bo-search`;
}

function portalHomeUrl(portal) {
  const host = portal.host || 'vendors.planetbids.com';
  return `https://${host}/portal/${encodeURIComponent(portal.portalId)}/portal-home`;
}

function detailUrl(portal, bidId) {
  const host = portal.host || 'vendors.planetbids.com';
  return `https://${host}/portal/${encodeURIComponent(portal.portalId)}/bo/bo-detail/${encodeURIComponent(bidId)}`;
}

function request(url, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'close',
        'DNT': '1',
        'Pragma': 'no-cache',
        'Referer': portalHomeUrlFromSearch(url),
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0'
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

function portalHomeUrlFromSearch(url) {
  try {
    return new URL(url).origin + '/';
  } catch (_) {
    return 'https://vendors.planetbids.com/';
  }
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
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|td|th)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
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

function isoDate(value) {
  if (!value) return '';
  const cleaned = String(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:PST|PDT|MST|MDT|CST|CDT|EST|EDT|PT|MT|CT|ET)\b/gi, '')
    .trim();

  const match = cleaned.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i);
  const candidate = match ? match[0] : cleaned;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function inferTrade(title, description, category) {
  const text = [title, description, category].filter(Boolean).join(' ').toLowerCase();

  if (/\b(roof|roofing|reroof|re-roof|membrane|gutter)\b/.test(text)) return 'roofing';
  if (/\b(concrete|sidewalk|curb|gutter|ada\s+ramp|flatwork)\b/.test(text)) return 'concrete';
  if (/\b(asphalt|pavement|paving|overlay|street|road|striping|seal\s*coat|slurry|traffic\s+control)\b/.test(text)) return 'paving';
  if (/\b(water|wastewater|sewer|stormwater|drainage|culvert|manhole|pipeline|pipe|utility|tank|pump\s+station)\b/.test(text)) return 'utilities';
  if (/\b(fence|fencing|gate)\b/.test(text)) return 'fencing';
  if (/\b(hvac|mechanical|boiler|chiller|plumbing|bathroom|restroom)\b/.test(text)) return 'mechanical';
  if (/\b(electrical|lighting|signal|generator|access\s+control|camera|low\s+voltage|switchgear)\b/.test(text)) return 'electrical';
  if (/\b(landscape|irrigation|tree|turf|parks? improvement|trail)\b/.test(text)) return 'landscaping';
  if (/\b(building|renovation|remodel|tenant\s+improvement|facility|construction|improvements?|repair|replacement|maintenance|install|installation)\b/.test(text)) return 'general';
  return 'general';
}

function inferContractorFit(title, description, category) {
  const text = [title, description, category].filter(Boolean).join(' ').toLowerCase();

  if (/\b(consultant|consulting|engineering\s+services|design\s+services|architectural|study|assessment|planning|audit|software|website|marketing|legal|insurance|benefits|medical|therapist)\b/.test(text)) {
    return 'low';
  }
  if (/\b(construction|improvement|repair|replacement|rehab|rehabilitation|install|installation|asphalt|concrete|roof|fence|paving|water|sewer|stormwater|electrical|hvac|mechanical|plumbing|landscape|maintenance)\b/.test(text)) {
    return 'high';
  }
  return 'medium';
}

function parseRowsFromTables(html) {
  const rows = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html))) {
    const rowHtml = rowMatch[1];
    if (!/bo-detail|Bid Opportunities|Invitation|Project|Due/i.test(rowHtml)) continue;

    const cells = [];
    const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml))) cells.push(cellMatch[1]);
    if (cells.length < 3) continue;

    const detailLink = rowHtml.match(/href=["']([^"']*\/bo\/bo-detail\/([^"'/?#]+)[^"']*)["']/i);
    const bidId = detailLink ? decodeEntities(detailLink[2]) : '';
    const href = detailLink ? decodeEntities(detailLink[1]) : '';

    const cleanCells = cells.map(compactText).filter(Boolean);
    const titleCellIndex = cells.findIndex(cell => /bo-detail/i.test(cell));
    const title = compactText(titleCellIndex >= 0 ? cells[titleCellIndex] : cleanCells[1] || cleanCells[0]);

    if (!title || /^title$/i.test(title) || /^bid opportunities$/i.test(title)) continue;

    rows.push({
      bidId,
      href,
      title,
      posted: cleanCells.find(value => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(value)) || '',
      due: cleanCells.slice().reverse().find(value => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(value)) || '',
      invitation: cleanCells.find(value => /\b(?:IFB|RFP|RFQ|RFB|Q|BID|NO\.?|#)?\s*[A-Z0-9-]{2,}\b/i.test(value) && value !== title) || '',
      rawCells: cleanCells
    });
  }

  return rows;
}

function parseRowsFromText(html) {
  const text = stripHtml(html);
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const rows = [];

  // Search engine and no-JS render often flatten rows like:
  // 05/20/2026, Street Preventive Maintenance FY 25/26, 26-CO-EN-1139, 06/18/2026 2:00pm
  for (const line of lines) {
    const parts = line.split(/\s*[;,]\s*/).map(part => part.trim()).filter(Boolean);
    if (parts.length < 3 || !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) continue;

    const dateParts = parts.filter(part => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(part));
    if (!dateParts.length) continue;

    const titlePart = parts.find(part => !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(part) && part.length > 8) || '';
    if (!titlePart || /^bid opportunities$/i.test(titlePart)) continue;

    rows.push({
      bidId: '',
      href: '',
      title: titlePart,
      posted: dateParts[0],
      due: dateParts[dateParts.length - 1],
      invitation: parts.find(part => /\b(?:IFB|RFP|RFQ|RFB|Q|BID|NO\.?|#)?\s*[A-Z0-9]{2,}[-A-Z0-9]*\b/i.test(part) && part !== titlePart) || '',
      rawCells: parts
    });
  }

  return rows;
}

function extractRows(html) {
  const tableRows = parseRowsFromTables(html);
  if (tableRows.length) return tableRows;
  return parseRowsFromText(html);
}

function mapRow(row, portal) {
  const title = row.title || 'Untitled PlanetBids Opportunity';
  const description = row.rawCells.join(' | ');
  const dueDate = isoDate(row.due);
  const postedDate = isoDate(row.posted);
  const solicitationNumber = row.invitation || row.bidId || '';
  const trade = inferTrade(title, description, '');
  const contractorFit = inferContractorFit(title, description, '');
  const sourceUrl = row.bidId
    ? detailUrl(portal, row.bidId)
    : (row.href ? new URL(row.href, portalSearchUrl(portal)).toString() : portalSearchUrl(portal));

  return {
    id: `planetbids-${portal.id}-${row.bidId || slugSafe(`${title}-${solicitationNumber}-${dueDate}`)}`,
    sourceId: `${portal.id}:${row.bidId || solicitationNumber || slugSafe(title)}`,
    title,
    slug: `${slugSafe(title)}-${row.bidId || slugSafe(solicitationNumber || dueDate)}`,
    state: String(portal.state || 'colorado').toLowerCase(),
    city: portal.city || 'Colorado',
    county: portal.county || '',
    trade,
    agency: portal.agency,
    postedDate,
    dueDate,
    estimatedValue: 'Not listed',
    projectType: contractorFit === 'low' ? 'professional-services' : 'construction-procurement',
    projectTypeLabel: contractorFit === 'low' ? 'Professional Services' : 'Construction Procurement',
    contractorFit,
    filterTags: unique([
      'planetbids',
      portal.id,
      portal.city,
      portal.county,
      trade,
      contractorFit === 'low' ? 'consulting' : 'contractor-relevant'
    ].map(value => String(value || '').toLowerCase())),
    summary: `${title}. Public procurement opportunity listed through PlanetBids for ${portal.agency}.`,
    requirements: unique([
      solicitationNumber ? `Invitation / reference: ${solicitationNumber}` : '',
      postedDate ? `Posted: ${postedDate}` : '',
      dueDate ? `Due: ${dueDate}` : '',
      row.rawCells.length ? `Portal row: ${row.rawCells.join(' | ')}` : ''
    ]),
    sourceName: SOURCE_NAME,
    sourceUrl,
    sourceLookupInstructions: `Open the ${portal.agency} PlanetBids portal and search by title or invitation number.`,
    sourceLookupSteps: [
      `Open ${portal.agency} PlanetBids Bid Opportunities.`,
      'Filter to active/open bids if needed.',
      solicitationNumber ? `Search or locate reference ${solicitationNumber}.` : `Search for ${title}.`,
      'Open the matching opportunity record for documents and submission instructions.'
    ],
    solicitationRef: solicitationNumber,
    solicitationNumber,
    buyer: portal.agency,
    buyerEmail: portal.buyerEmail || '',
    matchKeywords: unique([
      trade,
      'planetbids',
      portal.id,
      portal.agency,
      portal.city,
      portal.county,
      solicitationNumber
    ].map(value => String(value || '').toLowerCase())),
    canonicalKey: [
      title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      String(portal.agency || '').toLowerCase().trim(),
      dueDate
    ].join('|')
  };
}

async function fetchPortal(portal) {
  const url = portalSearchUrl(portal);
  const response = await request(url);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`${portal.id} PlanetBids returned HTTP ${response.statusCode}`);
  }

  const rows = extractRows(response.body)
    .filter(row => row && row.title && !/\bclosed\b|\bcanceled\b|\bcancelled\b|\brejected\b/i.test(row.rawCells.join(' ')))
    .map(row => mapRow(row, portal));

  return rows;
}

async function fetchOpportunities() {
  const all = [];

  for (const portal of PORTALS) {
    try {
      const rows = await fetchPortal(portal);
      console.log(`planetbids:${portal.id}: ${rows.length} raw records.`);
      all.push(...rows);
    } catch (err) {
      console.warn(`planetbids: ${portal.id} failed: ${err.message}`);
    }
  }

  return all;
}

module.exports = {
  name: 'planetbids',
  sourceName: SOURCE_NAME,
  sourceUrl: PORTALS.length ? portalSearchUrl(PORTALS[0]) : 'https://vendors.planetbids.com/',
  replaceExisting: true,
  fetchOpportunities,
  _private: {
    PORTALS,
    extractRows,
    parseRowsFromTables,
    parseRowsFromText,
    mapRow,
    inferTrade,
    portalSearchUrl,
    detailUrl
  }
};
