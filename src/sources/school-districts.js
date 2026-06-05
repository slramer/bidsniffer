// school-districts source connector
// Placeholder connector for BidSniffer's automated harvest pipeline.
// Replace the sample-safe stub with real fetch/parsing logic when this source is ready.
// Source notes: Placeholder umbrella connector for district construction/procurement pages.

async function fetchOpportunities() {
  // Return raw records here. The master harvester normalizes them into the
  // canonical opportunity schema used by src/data/opportunities.json.
  // Keep this credential-free unless/until a source explicitly requires secrets.
  return [];
}

module.exports = {
  name: 'school-districts',
  sourceName: 'Colorado School District Procurement Sources',
  sourceUrl: 'https://www.cde.state.co.us/',
  fetchOpportunities
};
