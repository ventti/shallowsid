# Local usage report

```sh
python3 tools/usage_stats.py
open /tmp/shallowsid-usage/index.html
```

Requires Python 3 and an existing `gcloud auth login` with read access to
Cloud Monitoring, Cloud Logging and Firestore. No packages to install.
`GOOGLE_OAUTH_ACCESS_TOKEN` also works for an existing service-account login.
The tool makes read-only API calls; it does not enable services, logging,
billing or change permissions.

Options:

```sh
python3 tools/usage_stats.py --days 90 --max-log-entries 100000 \
  --output /tmp/shallowsid-usage/index.html
```

The standalone HTML works offline, with no external scripts or requests.
Rerun the command to refresh it. The period selector filters daily rows,
bandwidth totals and SID GET totals; file rankings cover the full fetched
window. Output defaults outside the repository so it cannot be accidentally
included in an app deployment.

## What the numbers mean

- **Daily bandwidth:** Google Monitoring `network/sent_bytes_count`, aligned to
  UTC calendar days. Selected-site traffic is separate from all project sites.
  The current day is partial and missing samples are unavailable, not zero.
- **Monthly quota:** latest `monthly_sent` samples per domain, summed across
  the project, including the retired site. Samples arrive asynchronously, so
  this is a snapshot estimate. The shared limit is not added per domain.
- **Hosting storage:** latest storage samples and shared quota; retained
  releases also use storage.
- **SID GET responses:** GET responses of any HTTP status for `.sid` paths under
  MUSICIANS, GAMES and DEMOS. Not unique files or listeners; repeated range
  requests count separately. Errors and cache revalidation responses are included.
  The ranking shows the top 50 SID paths.
- **Request logs:** read from existing Hosting `webrequests` logs, with a
  configurable scan cap. Partial results are explicitly marked as lower bounds.
  No returned logs means unavailable counts; it cannot establish whether
  logging was disabled or the period had no requests. Logs cannot reconstruct
  traffic before logging was enabled or after retention expired.
- **Sync groups:** aggregate document counts for `vaults2`. Old/migrated/shared records are not unique or active users.
- **Plays:** unavailable. Sync play history is encrypted, and browser caching
  means downloads cannot count plays.

Only daily totals, quota samples, document counts and aggregate SID paths
are embedded in the report. It never stores IPs, user agents, referrers,
query strings, sync keys or sync contents. Raw HTTP request logs may contain
visitor identifiers in Google Cloud; they are discarded during aggregation.

Sources: [Hosting metric definitions](https://docs.cloud.google.com/monitoring/api/metrics_gcp_d_h#firebasehosting),
[Hosting request logs](https://firebase.google.com/docs/hosting/web-request-logs-and-metrics),
[Firestore aggregate counts](https://firebase.google.com/docs/firestore/query-data/aggregation-queries).

The graph selector switches daily bandwidth to cumulative bandwidth from the
selected period’s start. Missing samples remain gaps. Sync update dates use
Firestore document metadata only: each record’s last write, grouped by UTC
date. They do not represent a historical count of sync events or active users.
