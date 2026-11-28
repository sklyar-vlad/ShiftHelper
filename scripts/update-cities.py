#!/usr/bin/env python3
"""Rebuild the local CC BY-SA 4.0 city snapshot from the pinned upstream CSV."""
import csv
import hashlib
import io
import json
import re
from pathlib import Path
from urllib.request import urlopen

REVISION = 'ae661bffe572880472249097c9b29c42b09650ea'
URL = f'https://raw.githubusercontent.com/hflabs/city/{REVISION}/city.csv'
with urlopen(URL, timeout=30) as response:
    content = response.read()
rows = list(csv.DictReader(io.StringIO(content.decode('utf-8'))))
cities = []
for row in rows:
    # The address retains the innermost city (Алупка), unlike the parent city column.
    match = re.search(r'(?:^|, )г (.+)$', row['address'])
    if not match:
        raise ValueError(f'Missing city: {row["fias_id"]}')
    name = match[1].rsplit(', г ', 1)[-1]
    region = row['region']
    kind = row['region_type']
    if kind == 'Респ':
        region = f'Республика {region}'
    elif kind == 'г':
        region = f'{region} (город федерального значения)'
    elif kind != 'Чувашия' and not (kind == 'обл' and 'область' in region):
        region += ' ' + {'обл': 'область', 'край': 'край', 'АО': 'автономный округ', 'Аобл': 'автономная область'}[kind]
    cities.append([name, region])
cities.sort()
assert len(cities) == 1117 and len({region for _, region in cities}) == 85
assert len({tuple(city) for city in cities}) == len(cities)
assert all(name.strip() and region.strip() for name, region in cities)
result = {
    'source': 'https://github.com/hflabs/city',
    'authors': 'DaData.ru / HFLabs',
    'revision': REVISION,
    'date': '2021-10-11',
    'license': 'CC BY-SA 4.0',
    'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0/',
    'sourceSha256': hashlib.sha256(content).hexdigest(),
    'changes': 'Only city name and region retained; city parsed from final city component of address; region abbreviations expanded. All 1117 source rows retained.',
    'cities': cities,
}
output = Path(__file__).resolve().parent.parent / 'frontend/src/shared/lib/cities.json'
output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
print(f'{len(cities)} cities, 85 region groups, {output.stat().st_size} bytes')
