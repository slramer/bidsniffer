#!/usr/bin/env node

// Verify PlanetBids portals before enabling them in the harvest connector.
//
// Usage:
//   node src/scripts/verify-planetbids-portals.js
//   node src/scripts/verify-planetbids-portals.js --portal 12345 --agency "Agency Name" --city Denver --county Denver --state colorado
//
// The script does not write data files. It only prints a verification report.

const { CANDIDATE_PLANETBIDS_PORTALS } = require('../sources/planetbids-portals');
const planetbids = require('../sources/planetbids');

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) return '';
  return process.argv[index + 1];
}

function cliPortal() {
  const portalId = argValue('--portal') || argValue('--portalId');
  if (!portalId) return null;

  return {
    id: argValue('--id') || `manual-${portalId}`,
    portalId,
    agency: argValue('--agency') || `Manual PlanetBids Portal ${portalId}`,
    city: argValue('--city') || 'Colorado',
    county: argValue('--county') || '',
    state: argValue('--state') || 'colorado'
  };
}

function isLikelyColorado(portal, rows) {
  const portalText = [portal.agency, portal.city, portal.county, portal.state, portal.notes].join(' ').toLowerCase();
  const rowText = rows.slice(0, 10).map(row => [row.title, row.summary, row.sourceUrl, ...(row.requirements || [])].join(' ')).join(' ').toLowerCase();
  const text = `${portalText} ${rowText}`;

  if (/\bcalifornia\b|\bca\b|\btexas\b|\btravis\b|\baustin\b|\bpasadena\b|\bsacramento\b|\bsan diego\b|\briverside\b/.test(text)) {
    return false;
  }

  return /\bcolorado\b|\bco\b|\bdenver\b|\bboulder\b|\barapahoe\b|\bjefferson\b|\badams\b|\bdouglas\b|\bel paso\b|\bfort collins\b|\baurora\b|\bcolorado springs\b/.test(text);
}

async function verifyPortal(portal) {
  const report = {
    id: portal.id,
    portalId: portal.portalId,
    agency: portal.agency,
    state: portal.state,
    status: 'unknown',
    readableRows: 0,
    likelyColorado: false,
    sampleTitles: [],
    error: ''
  };

  try {
    const rows = await planetbids._private.fetchPortal(portal);
    report.readableRows = rows.length;
    report.likelyColorado = isLikelyColorado(portal, rows);
    report.sampleTitles = rows.slice(0, 5).map(row => row.title);

    if (!rows.length) {
      report.status = 'no-readable-rows';
    } else if (!report.likelyColorado) {
      report.status = 'rejected-not-likely-colorado';
    } else {
      report.status = 'candidate-looks-usable-review-manually';
    }
  } catch (err) {
    report.status = 'failed';
    report.error = err.message;
  }

  return report;
}

async function main() {
  const manual = cliPortal();
  const portals = manual ? [manual] : CANDIDATE_PLANETBIDS_PORTALS;

  const reports = [];
  for (const portal of portals) {
    reports.push(await verifyPortal(portal));
  }

  console.log(JSON.stringify(reports, null, 2));

  const usable = reports.filter(item => item.status === 'candidate-looks-usable-review-manually');
  if (usable.length) {
    console.log('\nPotential verified entries after manual review:');
    for (const item of usable) {
      console.log(`- portalId ${item.portalId}: ${item.agency} (${item.readableRows} rows)`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
