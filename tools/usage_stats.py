#!/usr/bin/env python3
"""Generate a private, standalone usage report using read-only Google APIs."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from firestore_admin import access_token

UTC = timezone.utc
PREFIX = 'firebasehosting.googleapis.com/'


def stamp(value):
    return value.astimezone(UTC).isoformat().replace('+00:00', 'Z')


def date_time(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


class API:
    def __init__(self, project):
        self.project = project
        self.token, _ = access_token()

    def request(self, url, body=None):
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                     headers={'Authorization': 'Bearer ' + self.token,
                                              'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # No request bodies, credentials or raw logs in report errors.
            raise RuntimeError(f'API returned HTTP {error.code}') from None
        except urllib.error.URLError:
            raise RuntimeError('API connection failed') from None

    def metrics(self, metric, start, end, daily=False):
        params = {'filter': f'metric.type="{PREFIX}{metric}"',
                  'interval.startTime': stamp(start), 'interval.endTime': stamp(end),
                  'view': 'FULL', 'pageSize': 1000}
        if daily:
            params.update({'aggregation.alignmentPeriod': '86400s',
                           'aggregation.perSeriesAligner': 'ALIGN_SUM'})
        result = []
        while True:
            page = self.request(f'https://monitoring.googleapis.com/v3/projects/{self.project}/timeSeries?'
                                + urllib.parse.urlencode(params))
            result.extend(page.get('timeSeries', []))
            if not page.get('nextPageToken'):
                return result
            params['pageToken'] = page['nextPageToken']

    def count(self, collection):
        body = {'structuredAggregationQuery': {'structuredQuery': {'from': [{'collectionId': collection}]},
                                               'aggregations': [{'alias': 'total', 'count': {}}]}}
        result = self.request(f'https://firestore.googleapis.com/v1/projects/{self.project}/databases/(default)/documents:runAggregationQuery', body)
        for row in result:
            if 'result' in row:
                return int(row['result']['aggregateFields']['total']['integerValue'])
        raise RuntimeError('Count result missing')

    def logs(self, site, start, end, limit):
        body = {'resourceNames': [f'projects/{self.project}'], 'pageSize': min(1000, limit),
                'orderBy': 'timestamp asc',
                'filter': f'resource.type="firebase_domain" AND resource.labels.site_name="{site}" '
                          f'AND log_id("webrequests") AND timestamp>="{stamp(start)}" AND timestamp<"{stamp(end)}"'}
        counts, paths, requests, statuses = Counter(), Counter(), Counter(), Counter()
        scanned = 0
        while True:
            body['pageSize'] = min(1000, limit - scanned)
            page = self.request('https://logging.googleapis.com/v2/entries:list', body)
            entries = page.get('entries', [])
            aggregate_logs(entries, counts, paths, requests, statuses)
            scanned += len(entries)
            token = page.get('nextPageToken')
            if not token or scanned >= limit:
                return {'daily_downloads': dict(counts), 'top_files': paths.most_common(50),
                        'daily_requests': dict(requests), 'statuses': dict(statuses),
                        'scanned': scanned, 'complete': not bool(token),
                        'available': scanned > 0}
            body['pageToken'] = token

    def sync_updates(self):
        # Select only document names to retrieve metadata, never sync fields.
        body = {'structuredQuery': {'from': [{'collectionId': 'vaults2'}],
                                   'select': {'fields': [{'fieldPath': '__name__'}]}}}
        rows = self.request(f'https://firestore.googleapis.com/v1/projects/{self.project}/databases/(default)/documents:runQuery', body)
        dates = Counter()
        latest = None
        for row in rows:
            updated = row.get('document', {}).get('updateTime')
            if updated:
                dates[date_time(updated).astimezone(UTC).date().isoformat()] += 1
                if latest is None or date_time(updated) > date_time(latest):
                    latest = updated
        return {'latest': latest, 'dates': dict(sorted(dates.items(), reverse=True))}


def aggregate_logs(entries, counts, paths, requests, statuses):
    """Keep UTC day, status and SID path only; discard all visitor identifiers."""
    for entry in entries:
        http = entry.get('httpRequest', {})
        try:
            day = date_time(entry['timestamp']).astimezone(UTC).date().isoformat()
            status = int(http.get('status', 0))
        except (KeyError, ValueError, TypeError):
            continue
        requests[day] += 1
        statuses[str(status)] += 1
        path = urllib.parse.unquote(urllib.parse.urlsplit(http.get('requestUrl', '')).path)
        if (http.get('requestMethod') == 'GET' and status > 0
                and re.fullmatch(r'/(MUSICIANS|GAMES|DEMOS)/[^\x00-\x1f]+\.sid', path, re.IGNORECASE)):
            counts[day] += 1
            paths[path.lstrip('/')] += 1


def numeric(point):
    value = point['value']
    return float(value.get('int64Value', value.get('doubleValue', 0)))


def daily_bytes(series, site=None):
    totals = defaultdict(float)
    for row in series:
        if site and row['resource']['labels'].get('site_name') != site:
            continue
        for point in row.get('points', []):
            # Daily aligned delta bucket ends at the following UTC midnight.
            day = (date_time(point['interval']['endTime']) - timedelta(microseconds=1)).date().isoformat()
            totals[day] += numeric(point)
    return dict(totals)


def latest_values(series, month=None):
    values = []
    for row in series:
        points = row.get('points', [])
        if not points:
            continue
        point = max(points, key=lambda p: p['interval']['endTime'])
        if month and date_time(point['interval']['endTime']).strftime('%Y-%m') != month:
            continue
        values.append({'value': numeric(point), 'at': point['interval']['endTime'],
                       'site': row['resource']['labels'].get('site_name', '')})
    return values


def collect(api, site, days, log_limit):
    now = datetime.now(UTC)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=days - 1)
    month_start = today.replace(day=1)
    data = {'project': api.project, 'site': site, 'generated': stamp(now),
            'start': start.date().isoformat(), 'days': days, 'errors': [],
            'daily_site_bytes': {}, 'daily_project_bytes': {}, 'gauges': {},
            'sync_groups': None, 'logs': None}
    def attempt(label, operation):
        try:
            return operation()
        except RuntimeError as error:
            data['errors'].append(f'{label}: {error}')
            return None
    # Monitoring aligns buckets backwards from the requested end time.
    # Use the next UTC midnight so these are calendar days, not rolling days.
    traffic = attempt('Hosting bandwidth', lambda: api.metrics('network/sent_bytes_count', min(start, month_start), today + timedelta(days=1), True))
    if traffic is not None:
        data['daily_site_bytes'] = daily_bytes(traffic, site)
        data['daily_project_bytes'] = daily_bytes(traffic)
    for metric in ('network/monthly_sent', 'network/monthly_sent_limit', 'storage/total_bytes', 'storage/limit'):
        series = attempt(metric, lambda metric=metric: api.metrics(metric, now - timedelta(days=35), now))
        data['gauges'][metric] = latest_values(series or [], now.strftime('%Y-%m') if metric == 'network/monthly_sent' else None)
    data['sync_groups'] = attempt('Sync group count', lambda: api.count('vaults2'))
    data['sync_updates'] = attempt('Sync update dates', api.sync_updates)
    data['logs'] = attempt('Hosting request logs', lambda: api.logs(site, start, now, log_limit))
    return data


def write_report(data, destination):
    template = Path(__file__).with_name('usage_stats.html').read_text()
    # JSON stays inert even when a path contains HTML or a closing script tag.
    payload = json.dumps(data).replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(template.replace('__REPORT_DATA__', payload))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', default='shallowsid')
    parser.add_argument('--site', default='shallowsid')
    parser.add_argument('--days', type=int, default=30)
    parser.add_argument('--max-log-entries', type=int, default=20000)
    parser.add_argument('--output', type=Path, default=Path('/tmp/shallowsid-usage/index.html'))
    args = parser.parse_args()
    if not 1 <= args.days <= 90 or not 1 <= args.max_log_entries <= 1000000:
        parser.error('days must be 1–90; max-log-entries must be 1–1000000')
    if not all(re.fullmatch(r'[a-z0-9-]+', value) for value in (args.project, args.site)):
        parser.error('Invalid project or site name')
    start = time.perf_counter()
    data = collect(API(args.project), args.site, args.days, args.max_log_entries)
    write_report(data, args.output.resolve())
    print(f'Report: {args.output.resolve()}')
    print(f'Sync groups: {data["sync_groups"]}; request log entries: {(data["logs"] or {}).get("scanned", "unavailable")}')
    for error in data['errors']:
        print(error)
    print(f'Build duration: {time.perf_counter() - start:.2f}s')


if __name__ == '__main__':
    main()
