// denver source connector
// Placeholder connector for BidSniffer's automated harvest pipeline.
// Replace the sample-safe stub with real fetch/parsing logic when this source is ready.
// Source notes: Denver procurement and bidding opportunities.

async function fetchOpportunities() {
  // Return raw records here. The master harvester normalizes them into the
  // canonical opportunity schema used by src/data/opportunities.json.
  // Keep this credential-free unless/until a source explicitly requires secrets.
  return [];
}

module.exports = {
  name: 'denver',
  sourceName: 'City and County of Denver Purchasing',
  sourceUrl: 'https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/General-Services/Purchasing-Division/Bidding-Opportunities',
  fetchOpportunities
};
