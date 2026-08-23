import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Source files are refreshed daily. Stagger the jobs to avoid simultaneous downloads.
crons.cron("ingest OFAC SDN watchlist", "15 3 * * *", internal.watchlists.ingestOfac, {});
crons.cron("ingest UN consolidated watchlist", "45 3 * * *", internal.watchlists.ingestUn, {});
crons.cron("generate weekly compliance report", "30 4 * * 1", internal.complianceReports.generateWeekly, {});

export default crons;
