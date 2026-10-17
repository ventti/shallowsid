"""Accuracy and privacy boundaries for the local usage report."""
from collections import Counter
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
from usage_stats import aggregate_logs, daily_bytes, latest_values, write_report


class UsageStatsTests(unittest.TestCase):
    def test_sid_gets_include_all_statuses_and_no_identifiers(self):
        records = []
        for status, method, path in [(200, 'GET', '/MUSICIANS/A/Test.sid?private=secret'),
                                     (206, 'GET', '/MUSICIANS/A/Test.sid'),
                                     (304, 'GET', '/MUSICIANS/A/Test.sid'),
                                     (200, 'HEAD', '/MUSICIANS/A/Test.sid'),
                                     (404, 'GET', '/GAMES/Missing.sid'),
                                     (200, 'GET', '/private/person.sid')]:
            records.append({'timestamp': '2026-10-06T01:00:00Z', 'httpRequest': {
                'status': status, 'requestMethod': method, 'requestUrl': 'https://example.org' + path,
                'remoteIp': '192.0.2.42', 'userAgent': 'identifying-agent'}})
        counts, paths, requests, statuses = (Counter() for _ in range(4))
        aggregate_logs(records, counts, paths, requests, statuses)
        self.assertEqual(dict(counts), {'2026-10-06': 4})
        self.assertEqual(dict(paths), {'MUSICIANS/A/Test.sid': 3, 'GAMES/Missing.sid': 1})
        self.assertEqual(sum(requests.values()), 6)
        serialized = json.dumps([counts, paths, requests, statuses])
        for secret in ('secret', '192.0.2.42', 'identifying-agent', 'person'):
            self.assertNotIn(secret, serialized)

    def test_daily_buckets_and_site_scope(self):
        series = [{'resource': {'labels': {'site_name': site}}, 'points': [
            {'interval': {'endTime': '2026-10-07T00:00:00Z'}, 'value': {'int64Value': str(value)}}]}
            for site, value in [('shallowsid', 123), ('retired', 456)]]
        self.assertEqual(daily_bytes(series, 'shallowsid'), {'2026-10-06': 123})
        self.assertEqual(daily_bytes(series), {'2026-10-06': 579})

    def test_prior_month_gauges_are_excluded(self):
        series = [{'resource': {'labels': {'site_name': 'old'}}, 'points': [
            {'interval': {'endTime': '2026-09-30T23:00:00Z'}, 'value': {'int64Value': '9'}}]}]
        self.assertEqual(latest_values(series, '2026-10'), [])

    def test_report_cannot_inject_html_through_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'index.html'
            data = {'path': '</script><script>alert(1)</script>'}
            write_report(data, output)
            html = output.read_text()
            payload = re.search(r'<script id="report-data" type="application/json">(.*?)</script>', html, re.S).group(1)
            self.assertNotIn('<', payload)
            self.assertEqual(json.loads(payload), data)


if __name__ == '__main__':
    unittest.main()
