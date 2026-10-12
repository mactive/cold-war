"""Build factual research indexes from the official public collection snapshot.

Usage: python3 research/build_catalog.py /tmp/kards-all.json /tmp/kards-pools.json
No artwork, flavor text, or complete card rules text is republished.
"""
import csv
import json
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parent
raw = json.loads(Path(sys.argv[1]).read_text())['data']['cards']
pools = json.loads(Path(sys.argv[2]).read_text())['data']
assert not raw['pageInfo']['hasNextPage']
assert len(raw['edges']) == raw['pageInfo']['count']
active = {e['node']['cardId'] for e in pools['active']['edges']}
collectible = {e['node']['cardId'] for e in pools['collectible']['edges']}
nations = {'USA':'美国','Soviet':'苏联','Britain':'英国','Germany':'德国','Japan':'日本','France':'法国','Italy':'意大利','Poland':'波兰','Finland':'芬兰','Anzac':'澳新军团','Neutral':'中立'}
types = {'infantry':'步兵','tank':'坦克','artillery':'炮兵','fighter':'战斗机','bomber':'轰炸机','order':'指令','countermeasure':'反制'}
rows = []
for edge in raw['edges']:
    c = edge['node']; j = c['json']
    rows.append(dict(card_id=c['cardId'], name_zh=j['title'].get('zh-Hans',''), name_en=j['title'].get('en-EN',''), nation=nations[j['faction']], type=types[j['type']], deployment_cost=j['kredits'], operation_cost=j.get('operationCost'), attack=j.get('attack'), defense=j.get('defense'), rarity=j['rarity'], set=j['set'], reserved=c['reserved'], in_default_collection=c['cardId'] in active, in_collection_with_reserve=c['cardId'] in collectible, permanent_pool=j.get('permanent_pool',False), attributes=j.get('attributes',[]), exile=j.get('exile'), creates=j.get('can_create',[]), import_id=c['importId'], source_url='https://www.kards.com/zh/decks/collection?'+urlencode({'q':j['title'].get('en-EN',''),'showReserved':'yes','spawnables':'yes'})))
assert len({r['card_id'] for r in rows}) == len(rows)
metadata = dict(retrieved_on='2026-10-11', timezone='Asia/Shanghai', source_page='https://www.kards.com/zh/decks/collection', public_data_endpoint='https://herokuapi.kards.com/graphql', game_version=pools['currentGameVersion'], total_records=len(rows), default_collection_records=len(active), collection_with_reserve_records=len(collectible), note='官网公开卡库快照；不代表每条都可加入卡组。规则全文和美术未复制。属性保留原始标记，OnlySpawnable 不能单独用于判断主卡可收集性；以卡库筛选成员关系为准。', query='cards(language:"zh", first:2000, offset:0, showSpawnables:true, showExiles:true, showReserved:true) { pageInfo { count hasNextPage } edges { node { id cardId importId json reserved } } }')
(ROOT/'kards-card-index.json').write_text(json.dumps(dict(metadata=metadata,cards=rows),ensure_ascii=False,indent=2)+'\n')
with (ROOT/'kards-card-index.csv').open('w',encoding='utf-8-sig',newline='') as f:
    writer=csv.DictWriter(f,fieldnames=rows[0].keys());writer.writeheader()
    for r in rows: writer.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,list) else v for k,v in r.items()})
(ROOT/'snapshot-metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(metadata,ensure_ascii=False,indent=2))
print('Active types:',Counter(r['type'] for r in rows if r['in_default_collection']))
