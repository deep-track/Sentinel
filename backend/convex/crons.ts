import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Source files are refreshed daily.
crons.cron("ingest OFAC SDN watchlist", "15 3 * * *", internal.watchlists.ingestOfac, {});
crons.cron("ingest UN consolidated watchlist", "45 3 * * *", internal.watchlists.ingestUn, {});
crons.cron("ingest EU consolidated watchlist", "15 4 * * *", (internal as any).watchlists.ingestEu, {});
crons.cron("ingest UK sanctions list", "45 4 * * *", (internal as any).watchlists.ingestUk, {});
crons.cron("generate weekly compliance report", "30 4 * * 1", internal.complianceReports.generateWeekly, {});
// Deletes entries of superseded/failed watchlist versions in bounded,
// self-continuing batches (~20k rows are superseded per daily ingestion).
crons.interval("purge superseded watchlist versions", { hours: 1 }, internal.watchlists.purgeWatchlistVersions, {});

// Back Office service health probes (DeepTrack Live, OpenSanctions, scanning service).
crons.interval("probe external services", { minutes: 15 }, internal.backOfficeHealth.runHealthChecks, {});

// Ongoing AML monitoring: re-screens subjects that are due (each one daily)
// and alerts on new or more severe hits.
crons.interval("re-screen monitored AML subjects", { minutes: 15 }, internal.amlMonitoring.runDue, {});

// Client review deadlines: raise and alert cases past their deadline.
crons.interval("flag overdue client reviews", { minutes: 15 }, internal.clientReviews.flagOverdue, {});

// Self-service trials past their end date stop running checks.
crons.cron("expire ended trials", "0 5 * * *", (internal as any).signups.expireTrials, {});

// Back Office client health: drop logged API errors older than 30 days.
crons.interval("purge old API error logs", { hours: 1 }, internal.backOfficeClients.purgeApiErrors, {});

export default crons;
