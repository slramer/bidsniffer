// opengov source connector
// Harvests Colorado public procurement opportunities from OpenGov Procurement
// embed project-list pages. The normal /portal/{slug} pages may return 403 in
// some environments, while /portal/embed/{slug}/project-list is public and is
// the safer first target for credential-free harvesting.

const https = require('https');
const { URL } = require('url');

const SOURCE_NAME = 'OpenGov Colorado Procurement';
const BASE_URL = 'https://procurement.opengov.com';

const PORTALS = [
  {
    slug: 'pueblo',
    agencyFallback: 'City of Pueblo',
    cityFallback: 'Pueblo',
    countyFallback: 'Pueblo',
    stateFallback: 'colorado'
  },
  {
    // City site / public listings point vendors to OpenGov rather than BidNet.
    slug: 'wheatridgeco',
    agencyFallback: 'City of Wheat Ridge',
    cityFallback: 'Wheat Ridge',
    countyFallback: 'Jefferson',
    stateFallback: 'colorado'
  },
  {
    // Current public RFBs direct bidders to this OpenGov portal.
    slug: 'ouraycountyco',
    agencyFallback: 'Ouray County',
    cityFallback: 'Ouray',
    countyFallback: 'Ouray',
    stateFallback: 'colorado'
  },
  {
    // RTD moved public solicitations to OpenGov; keep it here instead of a one-off connector.
    slug: 'rtd-denver',
    agencyFallback: 'Regional Transportation District',
    cityFallback: 'Denver',
    countyFallback: 'Denver',
    stateFallback: 'colorado'
  }
];

function projectListUrl(slug) {
  return `${BASE_URL}/portal/embed/${encodeURIComponent(slug)}/project-list?departmentId=all&status=open&page=1&limit=100&sortField=proposalDeadline&sortDirection=ASC`;
}

function alternateProjectListUrl(slug) {
  return `${BASE_URL}/portal/${encodeURIComponent(slug)}?departmentId=all&status=open&page=1&limit=100&sortField=proposalDeadline&sortDirection=ASC`;
}

function publicPortalUrl(slug) {
  return `${BASE_URL}/portal/${encodeURIComponent(slug)}`;
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
        'Referer': `${BASE_URL}/`,
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
        const nextUrl = new URL(location, url).toString();
        request(nextUrl, redirectsRemaining - 1).then(resolve, reject);
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

function isoDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function findMatchingBracket(text, openIndex) {
  const openChar = text[openIndex];
  const closeChar = openChar === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) inString = false;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function extractRowsAfterKey(html, key) {
  const keyIndex = html.indexOf(key);
  if (keyIndex === -1) return null;
  const rowsKeyIndex = html.indexOf('"rows"', keyIndex);
  if (rowsKeyIndex === -1) return null;
  const rowsOpenIndex = html.indexOf('[', rowsKeyIndex);
  if (rowsOpenIndex === -1) return null;
  const rowsCloseIndex = findMatchingBracket(html, rowsOpenIndex);
  if (rowsCloseIndex === -1) return null;
  return JSON.parse(html.slice(rowsOpenIndex, rowsCloseIndex + 1));
}

function extractOpenGovRows(html) {
  const dataIndex = html.indexOf('window.__data=');
  const searchStart = dataIndex >= 0 ? dataIndex : 0;
  const candidates = [
    '"publicProject"',
    '"govProjects"',
    '"projects"',
    '"projectList"'
  ];

  for (const key of candidates) {
    const sliced = html.slice(searchStart);
    const rows = extractRowsAfterKey(sliced, key);
    if (Array.isArray(rows)) return rows;
  }

  // Last-resort fallback: first JSON rows array in the embedded state.
  const rowsKeyIndex = html.indexOf('"rows"', searchStart);
  if (rowsKeyIndex !== -1) {
    const rowsOpenIndex = html.indexOf('[', rowsKeyIndex);
    const rowsCloseIndex = rowsOpenIndex === -1 ? -1 : findMatchingBracket(html, rowsOpenIndex);
    if (rowsOpenIndex !== -1 && rowsCloseIndex !== -1) {
      return JSON.parse(html.slice(rowsOpenIndex, rowsCloseIndex + 1));
    }
  }

  throw new Error('Could not find OpenGov project rows in embedded project-list page.');
}

function getOrgName(row, portal) {
  return row.government?.organization?.name
    || row.government?.name
    || row.organization?.name
    || row.agency?.name
    || portal.agencyFallback;
}

function inferTrade(row) {
  const text = [
    row.title,
    row.summary,
    row.description,
    row.department?.name,
    row.template?.title,
    row.financialId
  ].filter(Boolean).join(' ').toLowerCase();

  if (/\b(roof|roofing|reroof|membrane|gutter)\b/.test(text)) return 'roofing';
  if (/\b(concrete|sidewalk|curb|gutter|ada\s+ramp|flatwork)\b/.test(text)) return 'concrete';
  if (/\b(asphalt|pavement|paving|mill|overlay|street|road|striping|seal\s*coat)\b/.test(text)) return 'paving';
  if (/\b(water|wastewater|sewer|stormwater|manhole|pipeline|pipe|utility)\b/.test(text)) return 'utilities';
  if (/\b(fence|fencing|gate)\b/.test(text)) return 'fencing';
  if (/\b(hvac|mechanical|boiler|chiller|plumbing)\b/.test(text)) return 'mechanical';
  if (/\b(electrical|lighting|signal|generator|access\s+control|camera|low\s+voltage)\b/.test(text)) return 'electrical';
  if (/\b(landscape|irrigation|tree|turf|parks? improvement)\b/.test(text)) return 'landscaping';
  if (/\b(building|renovation|remodel|tenant\s+improvement|facility|construction|improvements?)\b/.test(text)) return 'general';
  return 'general';
}

function inferContractorFit(row, trade) {
  const text = [row.title, row.summary, row.description, row.template?.title]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\b(consultant|consulting|engineering services|design services|architectural|study|assessment|planning|software|website|marketing)\b/.test(text)) {
    return 'low';
  }
  if (/\b(construction|improvement|repair|replacement|rehab|rehabilitation|install|installation|asphalt|concrete|roof|fence|paving|water|sewer|stormwater|electrical|hvac)\b/.test(text)) {
    return 'high';
  }
  return trade && trade !== 'general' ? 'medium' : 'medium';
}

function buildProjectUrl(portal, row) {
  return `${publicPortalUrl(portal.slug)}/projects/${encodeURIComponent(row.id)}`;
}

function mapRow(row, portal) {
  const title = row.title || 'Untitled OpenGov Opportunity';
  const summary = compactText(row.summary || row.description || '');
  const dueDate = isoDate(row.proposalDeadline || row.responseDeadline || row.dueDate || row.closeDate);
  const postedDate = isoDate(row.releaseProjectDate || row.created_at || row.createdAt || row.postedDate);
  const solicitationNumber = row.financialId || row.projectNumber || row.number || String(row.id || '');
  const trade = inferTrade(row);
  const contractorFit = inferContractorFit(row, trade);
  const department = row.department?.name || '';
  const procurementType = row.template?.title || row.projectType || '';
  const agency = getOrgName(row, portal);
  const city = row.government?.organization?.city || row.organization?.city || portal.cityFallback;
  const state = String(row.government?.organization?.state || row.organization?.state || portal.stateFallback || 'colorado').toLowerCase();

  return {
    id: `opengov-${portal.slug}-${row.id || slugSafe(`${title}-${dueDate}`)}`,
    sourceId: `${portal.slug}:${row.id || solicitationNumber}`,
    title,
    slug: `${slugSafe(title)}-${row.id || slugSafe(solicitationNumber)}`,
    state,
    city,
    county: portal.countyFallback || '',
    trade,
    agency,
    postedDate,
    dueDate,
    estimatedValue: 'Not listed',
    projectType: contractorFit === 'low' ? 'professional-services' : 'construction-procurement',
    projectTypeLabel: contractorFit === 'low' ? 'Professional Services' : 'Construction Procurement',
    contractorFit,
    filterTags: unique([
      'opengov',
      portal.slug,
      city,
      portal.countyFallback,
      trade,
      department,
      procurementType,
      contractorFit === 'low' ? 'consulting' : 'contractor-relevant'
    ].map(value => String(value || '').toLowerCase())),
    summary: summary || `${title}. Public procurement opportunity listed through OpenGov.`,
    requirements: unique([
      procurementType ? `Procurement type: ${procurementType}` : '',
      department ? `Department: ${department}` : '',
      solicitationNumber ? `Reference: ${solicitationNumber}` : '',
      postedDate ? `Released: ${postedDate}` : '',
      dueDate ? `Proposal deadline: ${dueDate}` : '',
      row.addendums?.length ? `${row.addendums.length} addendum/addenda listed` : ''
    ]),
    sourceName: SOURCE_NAME,
    sourceUrl: buildProjectUrl(portal, row),
    sourceLookupInstructions: `Open ${agency} OpenGov Procurement and search by title or reference number.`,
    sourceLookupSteps: [
      `Open ${agency} OpenGov Procurement.`,
      'Filter status to Active/Open if needed.',
      solicitationNumber ? `Search or locate reference ${solicitationNumber}.` : `Search or locate project ${row.id}.`,
      'Open the matching project record.'
    ],
    solicitationRef: solicitationNumber,
    solicitationNumber,
    buyer: department,
    buyerEmail: '',
    matchKeywords: unique([
      trade,
      'opengov',
      portal.slug,
      agency,
      city,
      portal.countyFallback,
      department,
      procurementType,
      solicitationNumber
    ].map(value => String(value || '').toLowerCase())),
    canonicalKey: [
      title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      String(agency || '').toLowerCase().trim(),
      dueDate
    ].join('|')
  };
}

async function fetchPortal(portal) {
  const urls = [projectListUrl(portal.slug), alternateProjectListUrl(portal.slug)];
  let lastStatus = 0;

  for (const url of urls) {
    const response = await request(url);
    lastStatus = response.statusCode;

    if (response.statusCode >= 200 && response.statusCode < 300) {
      const rows = extractOpenGovRows(response.body);
      return rows
        .filter(row => row && row.title && !row.isPrivate && String(row.status || 'open').toLowerCase() === 'open')
        .map(row => mapRow(row, portal));
    }

    if (![403, 404].includes(response.statusCode)) {
      throw new Error(`${portal.slug} OpenGov returned HTTP ${response.statusCode}`);
    }
  }

  console.warn(`opengov: ${portal.slug} returned HTTP ${lastStatus}; skipping.`);
  return [];
}

async function fetchOpportunities() {
  const all = [];

  for (const portal of PORTALS) {
    try {
      const rows = await fetchPortal(portal);
      console.log(`opengov:${portal.slug}: ${rows.length} raw records.`);
      all.push(...rows);
    } catch (err) {
      console.warn(`opengov: ${portal.slug} failed: ${err.message}`);
    }
  }

  return all;
}

module.exports = {
  name: 'opengov',
  sourceName: SOURCE_NAME,
  sourceUrl: projectListUrl(PORTALS[0].slug),
  replaceExisting: true,
  fetchOpportunities,
  _private: {
    PORTALS,
    extractOpenGovRows,
    mapRow,
    inferTrade,
    projectListUrl,
    alternateProjectListUrl
  }
};
