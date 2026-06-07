// CivicEngage / CivicPlus bid postings source connector
// Harvests Colorado public bid pages that use the common Bids.aspx / bidID pattern.
// This is intentionally platform-based: agencies are configuration, not separate connectors.

const https = require('https');
const { URL } = require('url');

const SOURCE_NAME = 'Colorado CivicEngage Bid Postings';

const AGENCIES = [
  {
    id: 'clear-creek-county',
    agency: 'Clear Creek County',
    city: 'Georgetown',
    county: 'Clear Creek',
    url: 'https://www.co.clear-creek.co.us/Bids.aspx'
  },
  {
    id: 'gunnison-county',
    agency: 'Gunnison County',
    city: 'Gunnison',
    county: 'Gunnison',
    url: 'https://www.gunnisoncounty.org/Bids.aspx'
  },
  {
    id: 'steamboat-springs',
    agency: 'City of Steamboat Springs',
    city: 'Steamboat Springs',
    county: 'Routt',
    url: 'https://www.steamboatsprings.net/Bids.aspx'
  },
  {
    id: 'montrose',
    agency: 'City of Montrose',
    city: 'Montrose',
    county: 'Montrose',
    url: 'https://www.cityofmontrose.org/Bids.aspx'
  },
  {
    id: 'lake-county',
    agency: 'Lake County',
    city: 'Leadville',
    county: 'Lake',
    url: 'https://www.lakecountyco.gov/Bids.aspx'
  },
  {
    id: 'san-miguel-county',
    agency: 'San Miguel County',
    city: 'Telluride',
    county: 'San Miguel',
    url: 'https://www.sanmiguelcountyco.gov/Bids.aspx'
  },
  {
    id: 'fruita',
    agency: 'City of Fruita',
    city: 'Fruita',
    county: 'Mesa',
    url: 'https://www.fruita.org/Bids.aspx'
  },
  {
    id: 'grand-county',
    agency: 'Grand County',
    city: 'Hot Sulphur Springs',
    county: 'Grand',
    url: 'https://www.co.grand.co.us/Bids.aspx'
  },
  {
    id: 'park-county',
    agency: 'Park County',
    city: 'Fairplay',
    county: 'Park',
    url: 'https://www.parkcountyco.gov/Bids.aspx'
  },
  {
    id: 'cortez',
    agency: 'City of Cortez',
    city: 'Cortez',
    county: 'Montezuma',
    url: 'https://www.cortezco.gov/Bids.aspx'
  },
  {
    id: 'pueblo-west-metro',
    agency: 'Pueblo West Metropolitan District',
    city: 'Pueblo West',
    county: 'Pueblo',
    url: 'https://www.pueblowestmetro.us/Bids.aspx'
  },
  {
    id: 'fort-morgan',
    agency: 'City of Fort Morgan',
    city: 'Fort Morgan',
    county: 'Morgan',
    url: 'https://www.cityoffortmorgan.com/Bids.aspx'
  },
  {
    id: 'montrose-county',
    agency: 'Montrose County',
    city: 'Montrose',
    county: 'Montrose',
    url: 'https://www.montrosecounty.net/Bids.aspx'
  },
];

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
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
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
    .replace(/\bMST\b|\bMDT\b|\bMT\b/gi, '')
    .trim();

  if (/upon contract|open until/i.test(cleaned)) return '';

  const match = cleaned.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i);
  const candidate = match ? match[0] : cleaned;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function extractLabel(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}:\\s*([^\\n]+(?:\\n(?![A-Z][A-Za-z /&()#-]{1,40}:)[^\\n]+)*)`, 'i');
  const match = text.match(pattern);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function extractBidLinks(html, agency) {
  const links = [];
  const seen = new Set();
  const regex = /<a\b[^>]*href=["']([^"']*bids\.aspx\?[^"']*bidID=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html))) {
    const href = decodeEntities(match[1]);
    const title = compactText(match[2]);
    const url = new URL(href, agency.url).toString();
    const bidId = new URL(url).searchParams.get('bidID') || '';
    const key = `${agency.id}:${bidId || url}`;

    if (!bidId || seen.has(key)) continue;
    seen.add(key);
    links.push({ bidId, title, url });
  }

  return links;
}

function inferTrade(title, description, category) {
  const text = [title, description, category].filter(Boolean).join(' ').toLowerCase();

  if (/\b(roof|roofing|reroof|re-roof|membrane|gutter)\b/.test(text)) return 'roofing';
  if (/\b(concrete|sidewalk|curb|gutter|ada\s+ramp|flatwork)\b/.test(text)) return 'concrete';
  if (/\b(asphalt|pavement|paving|overlay|street|road|striping|seal\s*coat|roundabout)\b/.test(text)) return 'paving';
  if (/\b(water|wastewater|sewer|stormwater|drainage|culvert|manhole|pipeline|pipe|utility|tank)\b/.test(text)) return 'utilities';
  if (/\b(fence|fencing|gate)\b/.test(text)) return 'fencing';
  if (/\b(hvac|mechanical|boiler|chiller|plumbing|bathroom|restroom)\b/.test(text)) return 'mechanical';
  if (/\b(electrical|lighting|signal|generator|access\s+control|camera|low\s+voltage)\b/.test(text)) return 'electrical';
  if (/\b(landscape|irrigation|tree|turf|parks? improvement|trail)\b/.test(text)) return 'landscaping';
  if (/\b(building|renovation|remodel|rehab|construction|improvements?|repair|replacement|install|installation)\b/.test(text)) return 'general';
  return 'general';
}

function inferContractorFit(title, description, category, trade) {
  const text = [title, description, category].filter(Boolean).join(' ').toLowerCase();

  // CivicEngage is a very broad municipal procurement feed. For now BidSniffer
  // is still contractor-first, so obvious professional/admin services should not
  // sneak in as medium-fit just because they came from a bid page.
  if (/\b(attorney|legal services?|municipal court|prosecutor|prosecution|health care provider|medical provider|public opinion|polling|rate study|fee study|audit|planning|comprehensive plan|consultant|consulting|engineering services|design services|architectural|study|assessment|software|website|marketing)\b/.test(text)) {
    return 'low';
  }
  if (/\b(trash collection|recycling collection|solid waste rate|landfill rate)\b/.test(text)) {
    return 'low';
  }
  if (/\b(construction|improvement|repair|replacement|rehab|rehabilitation|install|installation|asphalt|concrete|roof|fence|paving|water|sewer|stormwater|electrical|hvac|trail|building|bathroom|demolition|excavation|leach field|septic|culvert|pipe|pipeline|drainage|road|bridge|parking lot)\b/.test(text)) {
    return 'high';
  }
  return trade && trade !== 'general' ? 'medium' : 'medium';
}

function shouldKeepRecord(record) {
  const title = String(record.title || '').toLowerCase();
  const summary = String(record.summary || '').toLowerCase();
  const statusText = record.requirements.join(' ').toLowerCase();
  const postedYear = Number(String(record.postedDate || '').slice(0, 4));

  if (/status:\s*(closed|awarded|cancelled|canceled)/.test(statusText)) return false;
  if (postedYear && postedYear < 2024) return false;
  if (/\bcivic city\b|sample bid|test bid|demo bid/.test(`${title} ${summary}`)) return false;

  // Keep the CivicEngage source focused on contractor opportunities for now.
  // Broader non-construction contractor services can be enabled later as a
  // separate product/filter decision instead of polluting the current dataset.
  if (record.contractorFit === 'low') return false;

  return true;
}

function parseDetail(html, link, agency) {
  const text = stripHtml(html);
  const pageTitle = compactText((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
  const bidTitle = extractLabel(text, 'Bid Title') || link.title || pageTitle || 'Untitled CivicEngage Opportunity';
  const bidNumber = extractLabel(text, 'Bid Number') || link.bidId;
  const category = extractLabel(text, 'Category');
  const status = extractLabel(text, 'Status');
  const publicationDate = isoDate(extractLabel(text, 'Publication Date/Time'));
  const closingDateRaw = extractLabel(text, 'Closing Date/Time') || extractLabel(text, 'Closes');
  const dueDate = isoDate(closingDateRaw);

  const descriptionMatch = text.match(/Description:\s*([\s\S]*?)(?:Publication Date\/Time:|Closing Date\/Time:|Submittal Information:|Contact Person:|Related Documents:|Plan & Spec Available:|Business Hours:|Qualifications:|Miscellaneous:|$)/i);
  const description = descriptionMatch ? descriptionMatch[1].replace(/\s+/g, ' ').trim() : '';
  const trade = inferTrade(bidTitle, description, category);
  const contractorFit = inferContractorFit(bidTitle, description, category, trade);

  return {
    id: `civicengage-${agency.id}-${link.bidId || slugSafe(`${bidTitle}-${dueDate}`)}`,
    sourceId: `${agency.id}:${link.bidId || bidNumber}`,
    title: bidTitle,
    slug: `${slugSafe(bidTitle)}-${link.bidId || slugSafe(bidNumber)}`,
    state: 'colorado',
    city: agency.city,
    county: agency.county,
    trade,
    agency: agency.agency,
    postedDate: publicationDate,
    dueDate,
    estimatedValue: 'Not listed',
    projectType: contractorFit === 'low' ? 'professional-services' : 'construction-procurement',
    projectTypeLabel: contractorFit === 'low' ? 'Professional Services' : 'Construction Procurement',
    contractorFit,
    filterTags: unique([
      'civicengage',
      'civicplus',
      agency.id,
      agency.city,
      agency.county,
      trade,
      category,
      contractorFit === 'low' ? 'consulting' : 'contractor-relevant'
    ].map(value => String(value || '').toLowerCase())),
    summary: description || `${bidTitle}. Public bid posting listed through ${agency.agency}.`,
    requirements: unique([
      category ? `Category: ${category}` : '',
      status ? `Status: ${status}` : '',
      bidNumber ? `Bid number: ${bidNumber}` : '',
      publicationDate ? `Published: ${publicationDate}` : '',
      closingDateRaw ? `Closing: ${closingDateRaw}` : '',
      dueDate ? `Normalized due date: ${dueDate}` : ''
    ]),
    sourceName: SOURCE_NAME,
    sourceUrl: link.url,
    sourceLookupInstructions: `Open the ${agency.agency} bid posting page and search for ${bidNumber || bidTitle}.`,
    sourceLookupSteps: [
      `Open ${agency.agency} bid postings.`,
      'Filter to open bids if needed.',
      bidNumber ? `Search or locate bid number ${bidNumber}.` : `Search or locate ${bidTitle}.`,
      'Open the matching bid detail record.'
    ],
    solicitationRef: bidNumber,
    solicitationNumber: bidNumber,
    buyer: '',
    buyerEmail: '',
    tradeConfidence: contractorFit === 'low' ? 'low' : 'source',
    matchedTradeKeywords: [],
    matchKeywords: unique([
      trade,
      'civicengage',
      'civicplus',
      agency.id,
      agency.agency,
      agency.city,
      agency.county,
      category,
      bidNumber
    ].map(value => String(value || '').toLowerCase())),
    canonicalKey: [
      bidTitle.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      agency.agency.toLowerCase(),
      dueDate
    ].join('|')
  };
}

async function fetchAgency(agency) {
  const response = await request(agency.url);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`${agency.id} CivicEngage returned HTTP ${response.statusCode}`);
  }

  const links = extractBidLinks(response.body, agency);
  const records = [];

  for (const link of links) {
    try {
      const detail = await request(link.url);
      if (detail.statusCode >= 200 && detail.statusCode < 300) {
        const record = parseDetail(detail.body, link, agency);
        if (shouldKeepRecord(record)) {
          records.push(record);
        }
      }
    } catch (err) {
      console.warn(`civicengage: ${agency.id} bid ${link.bidId} failed: ${err.message}`);
    }
  }

  return records;
}

async function fetchOpportunities() {
  const all = [];

  for (const agency of AGENCIES) {
    try {
      const records = await fetchAgency(agency);
      console.log(`civicengage:${agency.id}: ${records.length} normalized records.`);
      all.push(...records);
    } catch (err) {
      console.warn(`civicengage: ${agency.id} failed: ${err.message}`);
    }
  }

  return all;
}

module.exports = {
  name: 'civicengage',
  sourceName: SOURCE_NAME,
  sourceUrl: AGENCIES[0].url,
  replaceExisting: true,
  fetchOpportunities,
  _private: {
    AGENCIES,
    extractBidLinks,
    parseDetail,
    inferTrade,
    inferContractorFit,
    shouldKeepRecord
  }
};
