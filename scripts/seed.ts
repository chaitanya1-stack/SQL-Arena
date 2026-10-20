import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {db,transaction} from '../apps/api/db.js';
import {questionSchema} from '../packages/core/question.js';
import {contentHash} from '../packages/core/content-hash.js';
const bank=(JSON.parse(await readFile(new URL('../content/questions.json',import.meta.url),'utf8')) as unknown[]).map(q=>questionSchema.parse(q));
const publish=process.argv.includes('--publish');let report:Record<string,{passed:boolean,hash:string,engines?:string[]}>={};
if(publish)report=JSON.parse(await readFile(new URL('../content/validation-report.json',import.meta.url),'utf8')).questions;
try{await transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(723913)');for(const q of bank){
 const fingerprint=contentHash(q),r=report[q.id];
 if(publish&&(!r?.passed||r.hash!==fingerprint||!r.engines?.includes('mysql')||!r.engines?.includes('postgres')))throw new Error(`${q.id}: missing validation for the exact content on both Docker engines. Nothing published.`);
 await c.query('INSERT INTO questions(id,slug,title,difficulty,topics,companies,minutes) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',[q.id,q.slug,q.title,q.difficulty,q.topics,q.companies,q.minutes]);
 const {rows}=await c.query('SELECT id,content_hash FROM question_versions WHERE question_id=$1 ORDER BY version DESC LIMIT 1',[q.id]);
 let id=rows[0]?.id;if(rows[0]?.content_hash!==fingerprint){id=randomUUID();const n=(await c.query('SELECT COALESCE(MAX(version),0)+1 AS n FROM question_versions WHERE question_id=$1',[q.id])).rows[0].n;await c.query('INSERT INTO question_versions(id,question_id,version,body,content_hash) VALUES($1,$2,$3,$4,$5)',[id,q.id,n,JSON.stringify(q),fingerprint]);}
 if(publish){await c.query("UPDATE question_versions SET validation_status='passed',validation_report=$1 WHERE id=$2",[JSON.stringify(r),id]);await c.query('UPDATE questions SET published_version=$1,slug=$2,title=$3,difficulty=$4,topics=$5,companies=$6,minutes=$7,archived=false WHERE id=$8',[id,q.slug,q.title,q.difficulty,q.topics,q.companies,q.minutes,q.id]);}
 }});console.log(`${bank.length} questions seeded as ${publish?'validated published versions':'drafts; validate before publishing'}.`);}finally{await db.end();}
