import { readFileSync } from 'node:fs';

type Level = Record<string, any>;

interface Entity { name: string; id: number|string; levels?: Level[]; [k: string]: any }

const CKA = '/root/ClashKingAssets/assets/static_data';
const PLAN = '/root/coc-planner/public/data';

function load(p: string): { items: Entity[] } {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function idxById(items: Entity[]): Map<string|number, Entity> {
  const m = new Map();
  for (const e of items) m.set(e.id, e);
  return m;
}

const files = ['buildings','troops','heroes','spells','traps','pets','equipment','helpers'] as const;

let totalMismatches = 0;
let details: {file:string;id:string;name:string;field:string;cka:any;plan:any}[] = [];

for (const f of files) {
  const ckaItems = load(`${CKA}/${f}.json`).items;
  const planItems = load(`${PLAN}/${f}.json`).items;
  const ckaMap = idxById(ckaItems);
  const planMap = idxById(planItems);

  console.log(`\n=== ${f} ===  CKA:${ckaItems.length}  Planner:${planItems.length}`);

  // Level count diff
  const lvlDiffs: string[] = [];
  for (const e of ckaItems) {
    const p = planMap.get(e.id);
    if (!p) continue;
    const cn = (e.levels||[]).length;
    const pn = (p.levels||[]).length;
    if (cn !== pn) lvlDiffs.push(`${e.id}(${e.name||'no-name'}): CKA ${cn} vs Plan ${pn}`);
  }
  if (lvlDiffs.length) { console.log(`  level count diffs (${lvlDiffs.length}):`); lvlDiffs.slice(0,20).forEach(s=>console.log('   '+s)); }
  else console.log('  level counts: ALL MATCH');

  // Compare cost/time/th per level
  let fileMismatch = 0;
  for (const e of ckaItems) {
    const p = planMap.get(e.id);
    if (!p) continue;
    const lvls = e.levels || [];
    for (let i = 0; i < lvls.length; i++) {
      const cl = lvls[i];
      const pl = (p.levels||[])[i];
      if (!pl) continue;
      // Build a comparable cost number
      const costOf = (lv: Level) => {
        const c = lv.build_cost ?? lv.upgrade_cost ?? lv.cost;
        return Array.isArray(c) ? c[0] : (c && typeof c === 'object' ? JSON.stringify(c) : c);
      };
      const timeOf = (lv: Level) => lv.build_time ?? lv.upgrade_time ?? lv.time;
      const thOf = (lv: Level) => lv.required_townhall ?? lv.th ?? lv.required_th;
      const labOf = (lv: Level) => lv.required_lab_level ?? lv.lab;

      const cc = costOf(cl), pc = costOf(pl);
      const ct = timeOf(cl), pt = timeOf(pl);
      const ch = thOf(cl), ph = thOf(pl);
      const cl_ = labOf(cl), pl_ = labOf(pl);

      if (cc !== pc || ct !== pt || ch !== ph || cl_ !== pl_) {
        fileMismatch++;
        totalMismatches++;
        const m: {file:string;id:string;name:string;field:string;cka:any;plan:any} = {file:f,id:String(e.id),name:e.name||'no-name',field:'',cka:'',plan:''};
        const parts: string[] = [];
        if (cc !== pc) { m.field='cost'; m.cka=cc; m.plan=pc;}
        if (ct !== pt) { parts.push(`time CKA=${ct} Plan=${pt}`); }
        if (ch !== ph) { parts.push(`th CKA=${ch} Plan=${ph}`); }
        if (cl_ !== pl_) { parts.push(`lab CKA=${cl_} Plan=${pl_}`); }
        m.cka = `${m.cka}${parts.length?' | '+parts.join(' '):''}`;
        m.plan = `${m.plan}${parts.length?' | '+parts.join(' '):''}`;
        details.push(m);
        if (fileMismatch <= 15) console.log(`  MISMATCH ${e.id}(${e.name}) L${i+1}: cost CKA=${cc} Plan=${pc} | time=${ct}/${pt} th=${ch}/${ph} lab=${cl_}/${pl_}`);
      }
    }
  }
  console.log(`  ${fileMismatch} level-field mismatches in ${f}`);
}

console.log(`\n\nTOTAL FILE/LEVEL MISMATCHES: ${totalMismatches}`);
// Group by file
const byFile: Record<string, number> = {};
for (const d of details) byFile[d.file] = (byFile[d.file]||0)+1;
console.log('By file:', JSON.stringify(byFile));

// Show entities with most mismatches
const byId: Record<string, number> = {};
for (const d of details) byId[`${d.file}:${d.id}`] = (byId[`${d.file}:${d.id}`]||0)+1;
const topIds = Object.entries(byId).sort((a,b)=>b[1]-a[1]).slice(0,20);
console.log('\nEntities with most field mismatches (file:id: count):');
for (const [k,c] of topIds) console.log(`  ${k}: ${c}`);
