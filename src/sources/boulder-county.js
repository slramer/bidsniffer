// Boulder County procurement source connector
// Boulder County posts a public Current Solicitations chart in normal HTML,
// even though Bonfire/Euna is the official submission portal. Scrape the county
// page first to avoid relying on Bonfire's JavaScript-heavy portal.

const https = require('https');
const { URL } = require('url');

const SOURCE_NAME = 'Boulder County Procurement';
const SOURCE_URL = 'https://bouldercounty.gov/government/budget-and-finance/procurement/bid-opportunities/';
const AGENCY = 'Boulder County';

const CONTRACTOR_TERMS = /\b(?:aggregate|asphalt|building|carpet|construction|contractor|coverings?|drywall|electrical|elevator|erosion|fencing|fire\s+safety|flooring|hvac|install|installation|irrigation|landscap|mechanical|pest\s+control|plumbing|public\s+works|repair|replacement|roof|sidewalk|snow|window)\b/i;

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
    .replace(/<\/(p|div|li|h[1-6]|tr|td|th|section|article)>/gi, '\n')
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

function isoDate(value) {
  const match = String(value || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return '';
  const month = match[1].padStart(2, '0');
  const day = match[2].padStart(2, '0');
  return `${match[3]}-${month}-${day}`;
}

function absoluteUrl(href) {
  return new URL(decodeEntities(href), SOURCE_URL).toString();
}

function extractRows(html) {
  const chartIndex = html.search(/Current\s+Solicitations\s+Chart/i);
  const section = chartIndex >= 0 ? html.slice(chartIndex) : html;
  const stopIndex = section.search(/Contact\s+Us|Office\s+of\s+Financial\s+Management/i);
  const relevant = stopIndex > 0 ? section.slice(0, stopIndex) : section;

  const rows = [];
  const tableRowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = tableRowRegex.exec(relevant))) {
    const cells = Array.from(rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map(m => m[1]);
    if (cells.length < 4) continue;
    rows.push(parseCells(cells));
  }

  // The WordPress accessibility/plain-text fallback can flatten the chart into
  // lines like: 06/26/2026 2:00 pm SOQ-293-26 <a ...>Title</a> Department
  if (!rows.length) {
    const lineRegex = /(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm))\s+([A-Z]+-[\w-]+)\s+<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*([^<\n]+)/gi;
    let match;
    while ((match = lineRegex.exec(relevant))) {
      rows.push({
        dueText: compactText(match[1]),
        solicitationNumber: compactText(match[2]),
        title: compactText(match[4]),
        sourceUrl: absoluteUrl(match[3]),
        department: compactText(match[5])
      });
    }
  }

  return rows.filter(row => row.title && row.solicitationNumber);
}

function parseCells(cells) {
  const dueText = compactText(cells[0]);
  const solicitationNumber = compactText(cells[1]);
  const linkMatch = cells[2].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  const title = linkMatch ? compactText(linkMatch[2]) : compactText(cells[2]);
  const sourceUrl = linkMatch ? absoluteUrl(linkMatch[1]) : SOURCE_URL;
  const department = compactText(cells[3]);
  return { dueText, solicitationNumber, title, sourceUrl, department };
}

function shouldKeep(row) {
  const haystack = `${row.title} ${row.department} ${row.solicitationNumber}`;
  return CONTRACTOR_TERMS.test(haystack);
}

async function fetchOpportunities() {
  const { statusCode, body } = await request(SOURCE_URL);
  if (statusCode >= 400) {
    throw new Error(`${SOURCE_NAME} returned HTTP ${statusCode}`);
  }

  return extractRows(body)
    .filter(shouldKeep)
    .map(row => ({
      id: `boulder-county-${slugSafe(row.solicitationNumber || row.title)}`,
      title: row.title,
      state: 'colorado',
      city: 'Boulder',
      county: 'Boulder',
      agency: AGENCY,
      postedDate: new Date().toISOString().slice(0, 10),
      dueDate: isoDate(row.dueText),
      solicitationNumber: row.solicitationNumber,
      solicitationRef: row.solicitationNumber,
      sourceName: SOURCE_NAME,
      sourceUrl: row.sourceUrl,
      sourceLookupInstructions: 'Open the Boulder County public solicitation page. The official submission portal is linked from the county listing.',
      sourceLookupSteps: [
        'Open the Boulder County Bids and Proposals page.',
        'Find the solicitation number in the Current Solicitations Chart.',
        'Open the linked Boulder County / Bonfire opportunity for official documents and submission instructions.'
      ],
      summary: `${row.department || 'Boulder County'} solicitation listed by Boulder County Procurement. Title: ${row.title}.`,
      buyer: 'Boulder County Procurement',
      buyerEmail: 'procurement@bouldercounty.gov',
      matchKeywords: [row.title, row.department, row.solicitationNumber, 'boulder county'].filter(Boolean)
    }));
}

module.exports = {
  name: 'boulder-county',
  sourceName: SOURCE_NAME,
  sourceUrl: SOURCE_URL,
  fetchOpportunities
};
