// rtd source connector
// Harvests Regional Transportation District open procurement opportunities from
// the public OpenGov Procurement portal. The portal embeds the open project list
// in window.__data.publicProject.govProjects.rows, so this remains credential-free
// and does not require browser automation.

const https = require('https');
const { URL } = require('url');

const SOURCE_NAME = 'RTD OpenGov Procurement';
const BASE_URL = 'https://procurement.opengov.com';
const PORTAL_PATH = '/portal/rtd-denver';
const OPEN_PROJECTS_URL = `${BASE_URL}${PORTAL_PATH}?departmentId=all&status=open&page=1&limit=100&sortField=proposalDeadline&sortDirection=DESC`;

function request(url, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'close',
        'DNT': '1',
        'Pragma': 'no-cache',
        'Referer': `${BASE_URL}/`,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
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
    req.setTimeout(30000, () => {
      req.destroy(new Error(`Request timed out for ${url}`));
    });
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
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
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

function extractOpenGovRows(html) {
  const dataIndex = html.indexOf('window.__data=');
  if (dataIndex === -1) {
    throw new Error('Could not find window.__data in RTD OpenGov page.');
  }

  const publicProjectIndex = html.indexOf('"publicProject"', dataIndex);
  if (publicProjectIndex === -1) {
    throw new Error('Could not find publicProject state in RTD OpenGov page.');
  }

  const govProjectsIndex = html.indexOf('"govProjects"', publicProjectIndex);
  if (govProjectsIndex === -1) {
    throw new Error('Could not find govProjects state in RTD OpenGov page.');
  }

  const rowsKeyIndex = html.indexOf('"rows"', govProjectsIndex);
  if (rowsKeyIndex === -1) {
    throw new Error('Could not find govProjects.rows in RTD OpenGov page.');
  }

  const rowsOpenIndex = html.indexOf('[', rowsKeyIndex);
  if (rowsOpenIndex === -1) {
    throw new Error('Could not find opening rows array in RTD OpenGov page.');
  }

  const rowsCloseIndex = findMatchingBracket(html, rowsOpenIndex);
  if (rowsCloseIndex === -1) {
    throw new Error('Could not find closing rows array in RTD OpenGov page.');
  }

  const rowsJson = html.slice(rowsOpenIndex, rowsCloseIndex + 1);
  return JSON.parse(rowsJson);
}

function inferTrade(row) {
  const text = [row.title, row.summary, row.department?.name, row.template?.title]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\b(ticket\s+vending|tvm|fare\s+operations?|electronic\s+fare|low\s+voltage|installation|equipment\s+install)\b/.test(text)) return 'electrical';
  if (/\b(light\s+rail|rail|transit\s+asset|systems\s+engineering|brt|bus\s+rapid\s+transit)\b/.test(text)) return 'civil';
  if (/\b(trash|recycling|solid\s+waste|waste\s+collection)\b/.test(text)) return 'facilities';
  if (/\b(printing|graphics|decals?|banners?|marketing)\b/.test(text)) return 'signage';
  return 'general';
}

function inferContractorFit(row, trade) {
  const text = [row.title, row.summary, row.department?.name, row.template?.title]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\b(public\s+opinion|polling|consultant|consulting|gap\s+assessment|implementation\s+plan|asset\s+management)\b/.test(text)) return 'low';
  if (trade && trade !== 'general') return 'medium';
  return 'medium';
}

function buildProjectUrl(row) {
  return `${BASE_URL}${PORTAL_PATH}/projects/${encodeURIComponent(row.id)}`;
}

function mapRow(row) {
  const title = row.title || 'Untitled RTD Opportunity';
  const summary = compactText(row.summary || '');
  const dueDate = isoDate(row.proposalDeadline);
  const postedDate = isoDate(row.releaseProjectDate || row.created_at);
  const solicitationNumber = row.financialId || String(row.id || '');
  const trade = inferTrade(row);
  const contractorFit = inferContractorFit(row, trade);
  const department = row.department?.name || '';
  const procurementType = row.template?.title || '';

  return {
    id: `rtd-${row.id || slugSafe(`${title}-${dueDate}`)}`,
    sourceId: String(row.id || ''),
    title,
    slug: `${slugSafe(title)}-${row.id || slugSafe(solicitationNumber)}`,
    state: 'colorado',
    city: row.government?.organization?.city || 'Denver',
    county: 'Denver',
    trade,
    agency: 'Regional Transportation District',
    postedDate,
    dueDate,
    estimatedValue: 'Not listed',
    projectType: contractorFit === 'low' ? 'professional-services' : 'transit-procurement',
    projectTypeLabel: contractorFit === 'low' ? 'Professional Services' : 'Transit Procurement',
    contractorFit,
    filterTags: unique([
      'rtd',
      'opengov',
      'transit',
      'denver',
      trade,
      department,
      procurementType,
      contractorFit === 'low' ? 'consulting' : 'contractor-relevant'
    ].map(value => String(value || '').toLowerCase())),
    summary: summary || `${title}. RTD open procurement opportunity listed through OpenGov.`,
    requirements: unique([
      procurementType ? `Procurement type: ${procurementType}` : '',
      department ? `Department: ${department}` : '',
      solicitationNumber ? `Reference: ${solicitationNumber}` : '',
      postedDate ? `Released: ${postedDate}` : '',
      dueDate ? `Proposal deadline: ${dueDate}` : '',
      row.addendums?.length ? `${row.addendums.length} addendum/addenda listed` : ''
    ]),
    sourceName: SOURCE_NAME,
    sourceUrl: buildProjectUrl(row),
    sourceLookupInstructions: 'Open the RTD OpenGov Procurement portal and use the direct source link, or search RTD OpenGov by project title or reference number.',
    sourceLookupSteps: [
      'Open RTD OpenGov Procurement.',
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
      'rtd',
      'opengov',
      'regional transportation district',
      'denver',
      department,
      procurementType,
      solicitationNumber
    ].map(value => String(value || '').toLowerCase())),
    canonicalKey: [
      title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      'regional transportation district',
      dueDate
    ].join('|')
  };
}

async function fetchOpportunities() {
  const response = await request(OPEN_PROJECTS_URL);

  if (response.statusCode === 403) {
    console.warn('rtd: RTD OpenGov returned HTTP 403; skipping RTD for this run.');
    return [];
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`RTD OpenGov returned HTTP ${response.statusCode}`);
  }

  const rows = extractOpenGovRows(response.body);
  return rows
    .filter(row => row && row.status === 'open' && !row.isPrivate && row.title)
    .map(mapRow);
}

module.exports = {
  name: 'rtd',
  sourceName: SOURCE_NAME,
  sourceUrl: OPEN_PROJECTS_URL,
  replaceExisting: true,
  fetchOpportunities,
  // Exported for lightweight local verification against saved HTML fixtures.
  _private: {
    extractOpenGovRows,
    mapRow
  }
};
