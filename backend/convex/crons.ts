import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Source files are refreshed daily.
crons.cron("ingest OFAC SDN watchlist", "15 3 * * *", internal.watchlists.ingestOfac, {});
crons.cron("ingest UN consolidated watchlist", "45 3 * * *", internal.watchlists.ingestUn, {});
crons.cron("generate weekly compliance report", "30 4 * * 1", internal.complianceReports.generateWeekly, {});
// Deletes entries of superseded/failed watchlist versions in bounded,
// self-continuing batches (~20k rows are superseded per daily ingestion).
crons.interval("purge superseded watchlist versions", { hours: 1 }, internal.watchlists.purgeWatchlistVersions, {});

export default crons;
