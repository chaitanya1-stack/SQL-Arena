import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {questionSchema} from '../packages/core/question.js';
import {queryPolicy} from '../packages/core/query-policy.js';
const bank=(JSON.parse(await readFile(new URL('../content/questions.json',import.meta.url),'utf8')) as unknown[]).map(q=>questionSchema.parse(q));
assert.equal(bank.length,200);assert.equal(new Set(bank.map(q=>q.id)).size,200);assert.equal(new Set(bank.map(q=>q.slug)).size,200);assert.equal(new Set(bank.map(q=>q.solutions.postgres)).size,200);
for(const [d,n] of Object.entries({Easy:40,Medium:110,Hard:50}))assert.equal(bank.filter(q=>q.difficulty===d).length,n);
for(const q of bank){for(const d of ['postgres','mysql'] as const)assert.equal(queryPolicy(q.solutions[d]),null,`${q.id} ${d}`);assert.ok(q.tests.some(t=>t.expected.rows.length),`${q.id} needs a positive dataset`);assert.ok(q.tests.some(t=>t.hidden&&t.expected.rows.length),`${q.id} needs a positive hidden dataset`);for(const t of q.tables)assert.ok(t.rows.every(r=>r.length===t.columns.length),`${q.id}: invalid sample columns`);}
console.log(`Content structure passed: 200 distinct questions, 40 easy / 110 medium / 50 hard, ${bank.reduce((n,q)=>n+q.tests.length,0)} datasets. This is not engine verification.`);
