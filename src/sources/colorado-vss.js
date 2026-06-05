// colorado-vss source connector
// Placeholder connector for BidSniffer's automated harvest pipeline.
// Replace the sample-safe stub with real fetch/parsing logic when this source is ready.
// Source notes: Colorado statewide public purchasing portal.

async function fetchOpportunities() {
  // Return raw records here. The master harvester normalizes them into the
  // canonical opportunity schema used by src/data/opportunities.json.
  // Keep this credential-free unless/until a source explicitly requires secrets.
  return [];
}

module.exports = {
  name: 'colorado-vss',
  sourceName: 'Colorado Vendor Self Service',
  sourceUrl: 'https://vss.state.co.us/',
  fetchOpportunities
};
