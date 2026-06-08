# PlanetBids verification notes

PlanetBids is platform-worthy, but the initial Colorado search pass produced mostly false positives:

- `40669` matched because of “Colorado River Boulevard,” not Colorado the state.
- `50907` is Austin Transit Partnership at 203 Colorado St, Austin, TX.
- Several public portal IDs have active public works-looking rows, but their agency/state were not verified from search snippets alone.

Use `src/scripts/verify-planetbids-portals.js` before enabling any portal. Only move entries into `VERIFIED_PLANETBIDS_PORTALS` after confirming:

1. The portal belongs to a Colorado public agency.
2. `/bo/bo-search` is publicly readable.
3. It returns active/current opportunities.
4. At least some opportunities are construction/contractor relevant.
5. The rows are not already fully mirrored by BidNet/OpenGov/CDOT/VSS.

Verification command examples:

```bash
node src/scripts/verify-planetbids-portals.js
node src/scripts/verify-planetbids-portals.js --portal 12345 --agency "Agency Name" --city Denver --county Denver --state colorado
```

If a portal passes, add it to `VERIFIED_PLANETBIDS_PORTALS` in `src/sources/planetbids-portals.js`.
