#!/usr/bin/env python3
"""COMPARE-ONLY: ClashKingAssets (CKA) vs coc-data-test (CDT) data.
Focus: per-level upgrade time / cost / requirements + resource type. NO EDITS.

Key convention discovered empirically:
- CKA level L time/cost fields align with CDT level L+1 (cost to reach a level
  is stored one level lower in CKA).
- CKA level L requirement fields (TH, lab) align with CDT level L (same level).
The script detects the per-field alignment (shift in {-1,0,+1}) per entity and
reports remaining mismatches.
"""
import json, glob, os, re

CKA = '/root/ClashKingAssets/assets/static_data'
CDT = '/root/coc-data-test/data'

def dt_to_sec(v):
    if v is None: return None
    if isinstance(v, (int, float)): return int(v)
    return int(v.get('days',0)*86400 + v.get('hours',0)*3600 +
               v.get('minutes',0)*60 + v.get('seconds',0))

def norm_name(n):
    n = (n or '').lower().replace("'", '')
    return re.sub(r'[^a-z0-9]+', '', n)

def fmt_cost(v):
    if v is None: return '—'
    if isinstance(v, dict):
        parts = [f"{val} {k.replace('_',' ')}" for k, val in sorted(v.items()) if val]
        return ', '.join(parts) if parts else '0'
    return str(v)

def cka_items(name, village=None):
    with open(os.path.join(CKA, name)) as f:
        items = json.load(f)['items']
    if village:
        items = [i for i in items if i.get('village', 'home') == village]
    return items

def cdt_load(paths):
    out = {}
    for p in sorted(glob.glob(os.path.join(CDT, paths, '*.json'))):
        if p.endswith('index.json'):
            continue
        d = json.load(open(p))
        if 'levels' not in d:
            continue
        out[d.get('id', os.path.basename(p)[:-5])] = d
    return out

def match(cdt, cka_name):
    t = norm_name(cka_name)
    for d in cdt.values():
        if norm_name(d.get('name','')) == t:
            return d
    return None

def lv_map(ent):
    return {lv['level']: lv for lv in ent.get('levels', [])
            if isinstance(lv.get('level'), int)}

# ---- field specs per category type ----
# each spec: (field_label, cka_key, cdt_key, value_transform, align_shift_search)
# align: False = same-level only; True = auto-detect per-field shift in {-1,0,1}
def specs(cat):
    if cat in ('troops','spells'):
        s = [('time','upgrade_time','researchTime',dt_to_sec,True),
             ('cost','upgrade_cost','researchCost',None,True),
             ('th','required_townhall','townHallRequired',None,True),
             ('lab','required_lab_level','laboratoryRequired',None,True),
             ('res','upgrade_resource','researchCostResource',None,False)]
        if cat == 'spells':
            s += [('prod','production_building_level','spellFactoryLevelRequired',None,True),
                  ('hall2','hero_tavern_level','heroTavernLevelRequired',None,True)]
        return s
    if cat == 'buildings':
        return [('time','build_time','buildTime',dt_to_sec,True),
                ('cost','build_cost','buildCost',None,True),
                ('th','required_townhall','townHallRequired',None,True),
                ('res','upgrade_resource','buildCostResource',None,False)]
    if cat == 'heroes':
        return [('time','upgrade_time','upgradeTime',dt_to_sec,True),
                ('cost','upgrade_cost','upgradeCost',None,True),
                ('th','required_townhall','townHallRequired',None,True),
                ('hall','required_hero_tavern_level','heroHallLevelRequired',None,True),
                ('res','upgrade_resource','upgradeCostResource',None,False)]
    if cat == 'pets':
        return [('time','upgrade_time','upgradeTime',dt_to_sec,True),
                ('cost','upgrade_cost','upgradeCost',None,True),
                ('th','required_townhall','townHallRequired',None,True),
                ('house','required_pet_house_level','petHouseLevelRequired',None,True),
                ('res','upgrade_resource','upgradeCostResource',None,False)]
    if cat == 'traps':
        return [('time','build_time','buildTime',dt_to_sec,True),
                ('cost','build_cost','buildCost',None,True),
                ('th','required_townhall','townHallRequired',None,True),
                ('res','upgrade_resource','buildCostResource',None,False)]
    if cat == 'equipment':
        return [('shiny','shiny_ore','upgradeShinyOre',None,False),
                ('glowy','glowy_ore','upgradeGlowingOre',None,False),
                ('starry','starry_ore','upgradeStarryOre',None,False),
                ('blacksmith','required_blacksmith_level','blacksmithLevelRequired',None,True),
                ('th','required_townhall','townHallRequired',None,True)]
    raise ValueError(cat)

def cka_field_val(cat, cka_lv, key):
    if cat == 'equipment':
        cc = cka_lv.get('upgrade_cost') or {}
        return cc.get(key) if isinstance(cc, dict) else None
    return cka_lv.get(key)

def best_shift(cka, cdt, spec):
    """Return shift s (cdt_level = cka_level + s) minimizing mismatches; prefer 0."""
    label, ck, dk, trans, align = spec
    if not align:
        return 0
    eq = ck in ('shiny_ore','glowy_ore','starry_ore')
    return _best_shift(cka, cdt, label, ck, dk, trans, 'equipment' if eq else None)

def _best_shift(cka, cdt, label, ck, dk, trans, cat):
    cl = lv_map(cka); dl = lv_map(cdt)
    scores = {}
    for s in (0, 1, -1):
        mis = n = 0
        for lk, lv in cl.items():
            dk2 = lk + s
            if dk2 not in dl: continue
            a = cka_field_val(cat, lv, ck) if cat else lv.get(ck)
            b = dl[dk2].get(dk)
            if a is None and b is None: continue
            if trans: a, b = trans(a), trans(b)
            n += 1
            if a != b: mis += 1
        scores[s] = (mis, n)
    # pick lowest mis; ties -> prefer s=0, then most coverage
    ordered = sorted(scores, key=lambda s: (scores[s][0], 0 if s == 0 else 1, -scores[s][1]))
    return ordered[0]

def compare_entity(cka, cdt, cat):
    cl = lv_map(cka); dl = lv_map(cdt)
    out = []
    for label, ck, dk, trans, align in specs(cat):
        s = best_shift(cka, cdt, (label, ck, dk, trans, align)) if align else 0
        mis = []
        for lk, lv in sorted(cl.items()):
            dk2 = lk + s
            if dk2 not in dl: continue
            a = cka_field_val(cat, lv, ck) if cat == 'equipment' else lv.get(ck)
            b = dl[dk2].get(dk)
            if a is None and b is None: continue
            if trans: a, b = trans(a), trans(b)
            if a != b:
                mis.append({'cka_lv': lk, 'cdt_lv': dk2, 'field': label,
                            'cka': a, 'cdt': b, 'shift': s})
        out.append({'field': label, 'shift': s, 'n_mis': len(mis),
                    'detail': mis})
    return out

def run(cat_label, cka_list, cdt, cat, cka_only_note=''):
    rows = []
    matched_ids = set()
    for ci in cka_list:
        nm = ci.get('name','')
        cd = match(cdt, nm)
        if cd is None:
            rows.append({'cat': cat_label, 'name': nm, 'status': 'CKA-only'})
            continue
        matched_ids.add(cd.get('id'))
        res = compare_entity(ci, cd, cat)
        n_mis = sum(r['n_mis'] for r in res)
        rows.append({'cat': cat_label, 'name': nm, 'status': 'matched',
                     'n_mis': n_mis, 'results': res, 'cdt_slug': cd.get('id')})
    cdt_only = [i for i in cdt if i not in matched_ids]
    return rows, cdt_only

def print_report(cat_label, rows, cdt_only, limit=60):
    mm = [r for r in rows if r.get('n_mis', 0) > 0]
    cka_only = [r['name'] for r in rows if r['status'] == 'CKA-only']
    tot = sum(r['n_mis'] for r in mm)
    print('\n' + '#'*95)
    print(f"  {cat_label}: matched={len([r for r in rows if r['status']=='matched'])}, "
          f"entities-with-mismatches={len(mm)}, field-mismatches={tot}")
    if cka_only:
        print('  CKA-only (no CDT counterpart): ' + ', '.join(sorted(cka_only)))
    if cdt_only:
        print('  CDT-only (no CKA counterpart): ' + ', '.join(sorted(cdt_only)[:limit]) +
              (' ...' if len(cdt_only) > limit else ''))
    for r in sorted(mm, key=lambda z: -z['n_mis'])[:limit]:
        bits = []
        for rr in r['results']:
            if rr['n_mis']:
                ex = rr['detail'][0]
                bits.append(f"{rr['field']} s={rr['shift']:+d} x{rr['n_mis']} "
                            f"(e.g. CKA L{ex['cka_lv']} {rr['field']}: {ex['cka']} vs CDT L{ex['cdt_lv']}: {ex['cdt']})")
        print(f"  - {r['name']:<24} {r['n_mis']:<4} " + ' | '.join(bits))
    return tot

def main():
    total = 0
    report = {}

    r, co = run('TROOPS', cka_items('troops.json', 'home'), cdt_load('home/troops'), 'troops')
    total += print_report('TROOPS', r, co); report['troops'] = (r, co)

    r, co = run('SPELLS', cka_items('spells.json'), cdt_load('home/spells'), 'spells')
    total += print_report('SPELLS', r, co); report['spells'] = (r, co)

    r, co = run('HEROES', cka_items('heroes.json'), cdt_load('home/heroes'), 'heroes')
    total += print_report('HEROES', r, co); report['heroes'] = (r, co)

    r, co = run('EQUIPMENT', cka_items('equipment.json'), cdt_load('home/hero-equipment'), 'equipment')
    total += print_report('EQUIPMENT', r, co); report['equipment'] = (r, co)

    r, co = run('PETS', cka_items('pets.json'), cdt_load('home/pets'), 'pets')
    total += print_report('PETS', r, co); report['pets'] = (r, co)

    r, co = run('TRAPS', cka_items('traps.json', 'home'), cdt_load('home/traps'), 'traps')
    total += print_report('TRAPS', r, co); report['traps'] = (r, co)

    cdt_b = {}
    for sub in ('home/defenses','home/army-buildings','home/resource-buildings','home/crafted-defenses'):
        cdt_b.update(cdt_load(sub))
    r, co = run('BUILDINGS (home)', cka_items('buildings.json', 'home'), cdt_b, 'buildings')
    total += print_report('BUILDINGS (home)', r, co); report['buildings_home'] = (r, co)

    r, co = run('BUILDINGS (builder)', cka_items('buildings.json', 'builderBase'),
                cdt_load('builder/buildings'), 'buildings')
    total += print_report('BUILDINGS (builder)', r, co); report['buildings_builder'] = (r, co)

    r, co = run('TROOPS (builder)', cka_items('troops.json', 'builderBase'),
                cdt_load('builder/troops'), 'troops')
    total += print_report('TROOPS (builder)', r, co); report['troops_builder'] = (r, co)

    r, co = run('HEROES (builder)', cka_items('heroes.json', 'builderBase'),
                cdt_load('builder/heroes'), 'heroes')
    total += print_report('HEROES (builder)', r, co); report['heroes_builder'] = (r, co)

    with open('/root/coc-planner/compare-cka-cdt-report.json','w') as f:
        json.dump({k: {'rows': rows, 'cdt_only': co} for k, (rows, co) in report.items()},
                  f, indent=1, default=str)
    print('\n' + '='*95)
    print(f'GRAND TOTAL remaining field-level mismatches (after per-field alignment): {total}')
    print('Full JSON report -> /root/coc-planner/compare-cka-cdt-report.json')

if __name__ == '__main__':
    main()
