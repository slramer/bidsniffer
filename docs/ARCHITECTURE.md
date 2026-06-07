# BidSniffer Architecture & Roadmap

## Project Purpose

BidSniffer aggregates public construction bidding opportunities from multiple procurement systems and presents them in a searchable, contractor-friendly format.

### Goals

* Harvest opportunities automatically
* Normalize data across sources
* Deduplicate overlapping opportunities
* Categorize by trade and region
* Match contractors to relevant projects
* Deliver alerts and digests
* Become the easiest way for contractors to discover bid opportunities

---

# Current Architecture

## Pipeline

```text
Source
→ Source Connector
→ Harvest
→ Normalize
→ Dedupe
→ opportunities.json
→ Static Page Generation
→ Netlify Deployment
```

## Current Commands

```bash
npm run harvest
npm run generate
npm run build
```

---

# Opportunity Schema

```ts
type Opportunity = {
  // Identity
  id: string;
  source: string;
  sourceId: string;
  canonicalKey: string;

  // Opportunity Details
  title: string;
  description: string;
  trade: string;
  category: string;
  status: string;

  // Organization
  agency: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;

  // Geography
  region: string;
  county: string;
  city: string;
  state: string;

  // Dates
  postedDate: string;
  dueDate: string;
  lastUpdated: string;

  // Financials
  value: string;
  valueType: string;

  // Navigation
  sourceUrl: string;
  detailUrl: string;
  lookupInstructions: string;

  // Matching
  matchScore?: number;

  // Metadata
  tags: string[];
  createdAt: string;
}
```

---

# Source Types

## Direct Sources

Provide opportunities directly.

### Examples

* Colorado VSS
* Denver
* CDOT

## Aggregator Sources

Aggregate opportunities from many agencies.

### Examples

* BidNet
* DemandStar
* Bonfire
* PlanetBids

---

# Current Sources

## Colorado VSS

### Status

Live

### Authentication

* None

### Harvest Method

* Session extraction
* View Published Solicitations navigation
* Construction category search

### Notes

* Construction category code = 22
* No public deep links currently

---

## Denver

### Status

Live

### Authentication

* None

### Notes

* Direct source

---

## BidNet

### Status

Planned

### Type

* Aggregator

### Target

* Colorado construction opportunities

### Potential Coverage

* Aurora
* Arapahoe County
* Jefferson County
* Denver Water
* RTD
* School districts
* Municipal agencies

---

## CDOT

### Status

Planned

### Type

* Direct

---

## School Districts

### Status

Planned

### Type

* Direct

---

# Regions

## Denver Metro

* Denver
* Aurora
* Lakewood
* Arvada
* Littleton
* Golden
* Wheat Ridge
* Westminster
* Thornton
* Englewood
* Centennial
* Lone Tree
* Jefferson County
* Arapahoe County
* Adams County

## Colorado Springs / Pikes Peak

* Colorado Springs
* El Paso County

## Northern Colorado

* Fort Collins
* Loveland
* Larimer County
* Greeley
* Weld County

## Boulder County

* Boulder
* Longmont
* Louisville
* Lafayette
* Broomfield

## Mountain Region

* Summit
* Eagle
* Vail
* Aspen
* Glenwood Springs

## Western Slope

* Grand Junction
* Mesa County
* Montrose

## Southern Colorado

* Pueblo
* Canon City
* Trinidad

## Statewide

* State agencies
* Multi-region projects

---

# Trade Categories

* roofing
* hvac
* electrical
* concrete
* civil
* excavation
* utilities
* painting
* flooring
* demolition
* general

---

# Deduplication Strategy

## Primary

```txt
source + sourceId
```

## Secondary

```txt
canonicalKey
```

## Canonical Key

```txt
normalized title
+ agency
+ due date
```

### Example

```txt
water-line-replacement|city-of-aurora|2026-07-01
```

### Future Enhancements

* Fuzzy title matching
* AI-assisted duplicate detection

---

# Project Value Strategy

## Priority Order

1. Exact value from source
2. Engineer estimate
3. Historical estimate
4. AI estimate
5. Unknown

## valueType

* exact
* engineer_estimate
* historical_estimate
* ai_estimate
* unknown

---

# Contractor Matching

## Inputs

* Trade
* Region
* City
* Project Size

## Outputs

* Match Score
* Opportunity Ranking

Match scores appear only in contractor profile views.

---

# Automation

## Daily Harvest

* GitHub Actions
* Harvest
* Generate
* Commit Changes
* Netlify Deploy

---

# Current Technical Debt

* BidNet connector
* CDOT connector
* School district connector
* Source detail-page resolution
* Opportunity value estimation
* Region filtering UI
* Email alerts
* Saved searches

---

# Milestones

## Phase 1

* 5 sources
* 50+ opportunities

## Phase 2

* 100+ opportunities
* Region filters
* Email alerts

## Phase 3

* Contractor matching
* Saved searches
* Opportunity digests

## Phase 4

* Document analysis
* AI project sizing
* Historical award intelligence


---

# Opportunity Lifecycle

Additional metadata:

```ts
lastSeenAt: string;
```

Harvesters should update `lastSeenAt` every time an opportunity is observed.

Future enhancement:

* Mark opportunities as expired instead of deleting them.
* Expire when dueDate has passed or the opportunity has not been seen for a configurable period.
* Preserve historical opportunities for SEO and analytics.
