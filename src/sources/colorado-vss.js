// colorado-vss source connector
// Pulls public Colorado VSS construction solicitations from the CGI Advantage endpoint.
// No credentials required.
//
// If this fails with a checksum/viewState/session error, the next step is adding
// the intermediate "navigate to solicitations carousel" POST before the search POST.
// The initial GET already exposes session_info in moInitialResponse.

const https = require('https');

const BASE_URL = 'https://prd.co.cgiadvantage.com/PRDVSS1X1/Advantage4';
const CATEGORY_CONSTRUCTION = '22';

function request(method, url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;

    const req = https.request(url, {
      method,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'BidSnifferBot/0.1 (+https://bidsniffer.com)',
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        } : {}),
        ...headers
      }
    }, res => {
      let data = '';

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function extractInitialResponse(html) {
  const match = html.match(/var\s+moInitialResponse\s*=\s*(\{[\s\S]*?\});\s*-->/);

  if (!match) {
    throw new Error('Could not find moInitialResponse in Colorado VSS page source.');
  }

  try {
    return JSON.parse(match[1]);
  } catch (err) {
    throw new Error(`Could not parse moInitialResponse JSON: ${err.message}`);
  }
}

function epochToDate(value) {
  if (!value) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return new Date(n).toISOString().slice(0, 10);
}

function slugSafe(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function classifyTrade(row) {
  const text = [
    row.DOC_DSCR,
    row.DEPT_NM,
    row.DOC_CD_CONCAT
  ].filter(Boolean).join(' ').toLowerCase();

  if (/roof|roofing|membrane|flashing|shingle/.test(text)) return 'roofing';
  if (/hvac|mechanical|boiler|chiller|controls|air handler/.test(text)) return 'hvac';
  if (/electrical|generator|fire alarm|alarm|lighting|panel|conduit|service upgrade/.test(text)) return 'electrical';
  if (/concrete|sidewalk|curb|gutter|flatwork|paving|asphalt/.test(text)) return 'concrete';

  return 'general';
}

function docRefSlug(docRef) {
  const bracketMatch = String(docRef || '').match(/\[([^\]]+)\]/);
  return slugSafe(bracketMatch ? bracketMatch[1] : docRef);
}

function buildSearchPayload(initial) {
  const sessionInfo = initial.session_info || {};
  const viewState = initial.viewState || {};
  const checksum = initial.checksum || {};

  return {
    action: {
      appActionCode: null,
      customActionName: null,
      applicationAction: 'search',
      shouldIgnoreSysFeedback: false,
      backgroundAction: 'userInitiated',
      isShiftKey: false,
      hideActionButton: false,
      isEntpriseSrchCreateAction: false,
      bypassPopupClose: false,
      key: 'vss.page.VVSSX10019.gridView1.group1.cardSearch.searchActions.search',
      actionType: 'searchAction',
      actionCode: 'search',
      dsNameList: 'T1SO_SRCH_QRY',
      dataSource: 'T1SO_SRCH_QRY',
      viewName: 'gridView1',
      hotkey: 'SHIFT+E',
      name: 'search',
      isCarouselNavigation: true
    },
    checksum: {
      DATASOURCE: {
        T1SO_SRCH_QRY: checksum?.DATASOURCE?.T1SO_SRCH_QRY || 2618902905
      },
      VIEW: {
        gridView1: checksum?.VIEW?.gridView1 || 4254450655
      },
      DS_DATA: {
        T1SO_SRCH_QRY: checksum?.DS_DATA?.T1SO_SRCH_QRY || '-1'
      }
    },
    viewState: {
      'vss.page.VVSSX10019.gridView1.group1.cardSearch': { editable: true },
      'vss.page.VVSSX10019': {
        editable: false,
        hidden: false,
        closed: false,
        required: false,
        protected: false
      },
      'vss.page.VVSSX10019.gridView1.group1.cardSearch.search1': { editable: true },
      'vss.page.VVSSX10019.gridView1.group1.cardSearch.search1.showMoreLess': { closed: true },
      TOP_LEVEL_KV_PAIRS_MAP: viewState.TOP_LEVEL_KV_PAIRS_MAP || {}
    },
    data: {
      page_data: {
        alerts_data: {
          row_data: [],
          modal_row_data: []
        }
      },
      ds_query_data: {
        T1SO_SRCH_QRY: {
          SHOW_TXT: '3',
          SO_CAT_CD: CATEGORY_CONSTRUCTION
        }
      }
    },
    session_info: {
      session_id: sessionInfo.session_id,
      page_id: sessionInfo.page_id,
      csrf_token: sessionInfo.csrf_token
    }
  };
}

function mapRow(row) {
  const title = row.DOC_DSCR || 'Untitled Colorado VSS Solicitation';
  const docRef = row.DOC_REF || '';
  const docSlug = docRefSlug(docRef);
  const postedDate = epochToDate(row.PUB_DT);
  const dueDate = epochToDate(row.SO_CLSNG_DT_TM);
  const trade = classifyTrade(row);

  return {
    id: `colorado-vss-${docSlug || slugSafe(title)}`,
    title,
    slug: `${slugSafe(title)}-${docSlug}`.replace(/-+$/g, ''),
    state: 'colorado',
    city: 'Colorado',
    trade,
    agency: row.DEPT_NM || 'Colorado Vendor Self Service',
    postedDate,
    dueDate,
    estimatedValue: 'Not listed',
    summary: `${title}. ${row.DOC_CD_CONCAT || 'Public solicitation'} posted by ${row.DEPT_NM || 'Colorado VSS'}.`,
    sourceName: 'Colorado Vendor Self Service',
    //sourceUrl: `${BASE_URL}?doc=${encodeURIComponent(docRef || title)}`,
    sourceUrl: `${BASE_URL}`,
    requirements: [
      row.DOC_REF ? `Solicitation reference: ${row.DOC_REF}` : '',
      row.DOC_CD_CONCAT,
      row.SO_STA ? `Status code: ${row.SO_STA}` : '',
      row.BUYR_NM ? `Buyer: ${row.BUYR_NM}` : '',
      row.BUYR_EMAIL_AD ? `Buyer email: ${row.BUYR_EMAIL_AD}` : ''
    ].filter(Boolean),
    matchKeywords: [
      trade,
      row.DOC_CD,
      row.DOC_CD_CONCAT,
      row.DEPT_NM,
      row.BUYR_NM,
      row.BUYR_EMAIL_AD
    ].filter(Boolean).map(x => String(x).toLowerCase())
  };
}

async function fetchOpportunities() {
  const getResponse = await request('GET', BASE_URL);

  if (getResponse.statusCode < 200 || getResponse.statusCode >= 300) {
    throw new Error(`Colorado VSS initial GET failed with status ${getResponse.statusCode}`);
  }

  const initial = extractInitialResponse(getResponse.body);
  
  const cookie = Array.isArray(getResponse.headers['set-cookie'])
    ? getResponse.headers['set-cookie'].map(c => c.split(';')[0]).join('; ')
    : '';

  const navPayload = buildSolicitationsPayload(initial);
  const navResponse = await request('POST', BASE_URL, navPayload, cookie ? { Cookie: cookie } : {});
  const navJson = JSON.parse(navResponse.body);

  const payload = buildSearchPayload(navJson);

  if (!payload.session_info.session_id || !payload.session_info.csrf_token || !payload.session_info.page_id) {
    throw new Error('Colorado VSS initial response did not include session_id, csrf_token, and page_id.');
  }

  const postResponse = await request('POST', BASE_URL, payload, cookie ? { Cookie: cookie } : {});

  if (postResponse.statusCode < 200 || postResponse.statusCode >= 300) {
    throw new Error(`Colorado VSS search POST failed with status ${postResponse.statusCode}`);
  }

  let json;
  try {
    json = JSON.parse(postResponse.body);
    console.log("Colorado VSS response keys:", Object.keys(json || {}));
    console.log("Colorado VSS ds_data keys:", Object.keys(json?.data?.ds_data || {}));
    console.log("Colorado VSS feedback:", JSON.stringify(json?.systemFeedback || {}, null, 2));    
  } catch (err) {
    throw new Error(`Colorado VSS search response was not valid JSON: ${err.message}`);
  }

  const rows = json?.data?.ds_data?.T1SO_SRCH_QRY?.row_data || [];

  if (!Array.isArray(rows)) {
    throw new Error('Colorado VSS response did not contain expected row_data array.');
  }

  return rows.map(mapRow);
}

function buildSolicitationsPayload(initial) {
  return {
    action: {
      params: {
        targetLocation: 'noDisplay',
        targetComponentType: 'SystemInquiryPage'
      },
      actionType: 'pageOpen',
      targetQualifiedName: 'vss.page.VVSSX10019'
    },
    session_info: initial.session_info,
    key: 'vss.page.VAXXX03153.carouselView.carousel.solicitations',
    viewState: {
      'vss.page.VAXXX03153': {
        editable: false,
        hidden: false,
        closed: false,
        required: false,
        protected: false
      },
      TOP_LEVEL_KV_PAIRS_MAP: {
        CURR_LINK_KEY: 'vss.page.VAXXX03153.carouselView.carousel.newVendor',
        CURR_LINK_INDEX: '0'
      }
    }
  };
}

module.exports = {
  name: 'colorado-vss',
  sourceName: 'Colorado Vendor Self Service',
  sourceUrl: BASE_URL,
  fetchOpportunities
};
