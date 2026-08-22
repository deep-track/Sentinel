# Watchlist ingestion external sources

Official OFAC source references:

- OFAC SDN list download page: https://sanctionslist.ofac.treas.gov/Home/SdnList
- OFAC consolidated list page: https://sanctionslist.ofac.treas.gov/Home/ConsolidatedList
- OFAC file-format FAQ: https://ofac.treasury.gov/faqs/topic/1641

Official UN source reference:

- UN Security Council Consolidated List: https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list
- UN list updates: https://main.un.org/securitycouncil/en/content/list-updates-unsc-consolidated-list

Repository/backend document facts:

- Sentinel Backend Engineering Document, Version 2.0, August 2026, Section 4.3 specifies OFAC SDN and UN Consolidated daily ingestion, normalization of names and aliases, and rebuilding a fuzzy-match index at an 85% similarity threshold.
- The same document specifies Convex scheduled cron jobs and a Phase 3 watchlist-screening milestone.
- The current repository contains a live OpenSanctions adapter at lib/opensanctions.ts and flaggedEntities/reviewQueue schema tables, but no completed OFAC/UN file adapters or cron implementation were found before this build.
