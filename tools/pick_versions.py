#!/usr/bin/env python3
"""按用户规则为每个层级/实体/物品挑定一个设定版本，写入 data/lore-choices.json。

规则（用户原话："若有冲突随机选择不要折中"）：
- 来源之间有冲突 → 用系统真随机数（SystemRandom）从已加载的版本里挑一个，整体采用，不混合。
- 没有冲突 → 各版本说的是同一回事，取信息最全的那个（此时谈不上折中）。
- 结果一旦生成就固定下来，再次运行不会重掷；确实要重掷时加 --reroll。

用法：python3 tools/pick_versions.py [--research DIR] [--reroll]
"""
import argparse
import glob
import json
import os
import random
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'lore-choices.json')
RNG = random.SystemRandom()


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def richness(v):
    """粗略衡量一个版本写了多少有效信息，只在无冲突时用来挑最全的版本"""
    score = 0
    def walk(x):
        nonlocal score
        if isinstance(x, dict):
            for val in x.values():
                walk(val)
        elif isinstance(x, list):
            for val in x:
                walk(val)
        elif isinstance(x, str):
            s = x.strip().lower()
            if s and s not in ('unverified', 'unknown', 'n/a', '无', '未知'):
                score += min(len(s), 400)
    walk(v)
    return score


def choose(doc, kind, ident):
    versions = [v for v in doc.get('versions', []) if v.get('loaded')]
    conflicts = [c for c in doc.get('conflicts', []) if str(c).strip()]
    base = {
        'candidates': [v.get('source') for v in versions],
        'conflicts': conflicts,
    }
    if not versions:
        return {**base, 'source': None, 'method': 'none-loaded'}
    if len(versions) == 1:
        v = versions[0]
        return {**base, 'source': v.get('source'), 'url': v.get('url'), 'title': v.get('title'), 'method': 'only-source'}
    if conflicts:
        v = RNG.choice(versions)
        return {**base, 'source': v.get('source'), 'url': v.get('url'), 'title': v.get('title'), 'method': 'random-on-conflict'}
    v = max(versions, key=richness)
    return {**base, 'source': v.get('source'), 'url': v.get('url'), 'title': v.get('title'), 'method': 'no-conflict-most-complete'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--research', default=os.path.join(os.path.dirname(ROOT), 'backrooms-research'))
    ap.add_argument('--reroll', action='store_true')
    args = ap.parse_args()

    old = load(OUT) if os.path.exists(OUT) else None
    if old and not args.reroll:
        print('已存在 data/lore-choices.json，保持原选择（要重掷请加 --reroll）。只补充新出现的条目。')

    result = old if (old and not args.reroll) else {
        'rule': '有冲突时用 SystemRandom 从已加载版本中随机选一个整体采用，不混合；无冲突取信息最全的版本',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'levels': {}, 'entities': {}, 'items': {},
    }

    for path in sorted(glob.glob(os.path.join(args.research, 'levels', 'level-*.json'))):
        doc = load(path)
        lid = str(doc.get('level') or os.path.basename(path)[6:-5])
        if lid not in result['levels']:
            result['levels'][lid] = {**choose(doc, 'level', lid), 'file': path}

    for path in sorted(glob.glob(os.path.join(args.research, 'entities', '*.json'))):
        doc = load(path)
        key = doc.get('key') or os.path.basename(path)[:-5]
        if key not in result['entities']:
            result['entities'][key] = {**choose(doc, 'entity', key), 'en': doc.get('en'), 'zh': doc.get('zh'), 'file': path}

    items_path = os.path.join(args.research, 'items', 'items.json')
    if os.path.exists(items_path):
        for it in load(items_path).get('items', []):
            # 条目自带 key 优先（items.json 的 key 和 en 推出来的常常不一样，如 liquid_pain vs liquid_pain_(object_48)）
            key = (it.get('key') or '').strip() or (it.get('en') or '').strip().lower().replace(' ', '_')
            if key and key not in result['items']:
                result['items'][key] = {**choose(it, 'item', key), 'en': it.get('en'), 'zh': it.get('zh')}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    for kind in ('levels', 'entities', 'items'):
        rows = result[kind]
        by = {}
        for v in rows.values():
            by[v['method']] = by.get(v['method'], 0) + 1
        print(f'{kind}: {len(rows)} 条', by)
    missing = [v for v in result['levels'].values() if not v.get('source')]
    if missing:
        print('没有任何可用来源的层级：', [k for k, v in result['levels'].items() if not v.get('source')], file=sys.stderr)


if __name__ == '__main__':
    main()
