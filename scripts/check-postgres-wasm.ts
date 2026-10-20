// Supplemental offline SQL check only. This is NOT the required PostgreSQL 16
// Docker validation and never writes a publishable validation report.
import {readFile,writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {questionSchema} from '../packages/core/question.js';
import {compare} from '../packages/core/compare.js';
const bank=(JSON.parse(await readFile(new URL('../content/questions.json',import.meta.url),'utf8')) as unknown[]).map(q=>questionSchema.parse(q));
const db=new PGlite({parsers:{1082:v=>v,1114:v=>v,1184:v=>v}});const failures:{id:string,test:string,error:string}[]=[];let passed=0;
for(const q of bank)for(const t of q.tests){try{
 await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');await db.exec(q.schema.postgres);await db.exec(t.setup.postgres);
 const r=await db.query(q.solutions.postgres,[],{rowMode:'array'});
 const rows=(r.rows as unknown[][]).map(row=>row.map((v,i)=>v instanceof Date?(r.fields[i].dataTypeID===1082?v.toISOString().slice(0,10):v.toISOString().slice(0,19).replace('T',' ')):v));
 if(!compare(t.expected,{columns:r.fields.map(f=>f.name),rows},q.ordered,q.tolerance))throw new Error('Output mismatch: '+JSON.stringify(rows).slice(0,180));passed++;
 }catch(e){failures.push({id:q.id,test:t.id,error:(e as Error).message});}}
console.log(JSON.stringify({engine:await db.query('SELECT version()'),passed,failed:failures.length,failures},null,2));
await writeFile(new URL('../docs/offline-postgres-check.json',import.meta.url),JSON.stringify({kind:'supplemental-pglite-check-only',passed,failed:failures.length,failures},null,2));await db.close();if(failures.length)process.exitCode=1;
