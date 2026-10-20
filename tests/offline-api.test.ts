// Real PostgreSQL (PGlite) SQL semantics + Fastify request injection. This omits
// Redis/BullMQ and network transport; Docker integration remains a separate gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import {PGlite} from '@electric-sql/pglite';
import type {Queue} from 'bullmq';
import {db} from '../apps/api/db.js';
import {authRoutes} from '../apps/api/auth.js';
import {routes} from '../apps/api/routes.js';
import {contentHash} from '../packages/core/content-hash.js';
const pg=new PGlite();
const query=async(text:string,values?:unknown[])=>{const r=await pg.query(text,values);return {rows:r.rows,rowCount:r.affectedRows||r.rows.length};};
// Test adapter implements only the pg Pool methods used by these routes.
Object.assign(db,{query,connect:async()=>({query,release(){}})});
const app=Fastify();await app.register(cookie);await authRoutes(app);await routes(app,{} as Queue);
app.setErrorHandler((e:Error&{statusCode?:number},_,reply)=>reply.code(e.statusCode||500).send({error:e.message}));
const bank=JSON.parse(readFileSync(new URL('../content/questions.json',import.meta.url),'utf8'));
let learner='',admin='',uid='',vid='';
test.before(async()=>{
 await pg.exec(readFileSync(new URL('../db/001.sql',import.meta.url),'utf8'));
 for(const role of ['user','admin']){const email=`${role}@offline.invalid`;const r=await app.inject({method:'POST',url:'/api/auth/register',payload:{email,password:'a-long-offline-password',name:role}});assert.equal(r.statusCode,200,r.body);const value=r.cookies.map(c=>c.name+'='+c.value).join('; ');const u=await query('SELECT id FROM users WHERE email=$1',[email]);const id=(u.rows[0] as {id:string}).id;if(role==='user'){learner=value;uid=id;}else{admin=value;await query("UPDATE users SET role='admin' WHERE id=$1",[id]);}}
 const q=bank[0];vid=randomUUID();await query('INSERT INTO questions(id,slug,title,difficulty,topics,companies,minutes,published_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[q.id,q.slug,q.title,q.difficulty,q.topics,q.companies,q.minutes,vid]);await query("INSERT INTO question_versions(id,question_id,version,body,content_hash,validation_status) VALUES($1,$2,1,$3,$4,'passed')",[vid,q.id,JSON.stringify(q),contentHash(q)]);
});
test.after(async()=>{await app.close();await pg.close();});
test('offline API: sessions resolve correctly and admin authorization is enforced',async()=>{assert.equal((await app.inject({url:'/api/me',headers:{cookie:learner}})).json().user.id,uid);assert.equal((await app.inject({url:'/api/admin/questions',headers:{cookie:learner}})).statusCode,403);assert.equal((await app.inject({url:'/api/admin/questions',headers:{cookie:admin}})).statusCode,200);});
test('offline API: public browse filters correctly and never returns hidden data',async()=>{const r=await app.inject({url:'/api/questions?search=India&difficulty=Easy',headers:{cookie:learner}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().total,1);const q=(await app.inject({url:'/api/questions/q001'})).json();assert.equal(q.tests.length,1);assert.equal(q.solutions,undefined);assert.equal(q.tests[0].setup,undefined);});
test('offline API: private submissions and parameterized input',async()=>{const submitted=await app.inject({method:'POST',url:'/api/submissions',headers:{cookie:learner},payload:{versionId:vid,query:'SELECT 1',mode:'run',dialect:'postgres'}});assert.equal(submitted.statusCode,200,submitted.body);const id=submitted.json().id;assert.equal((await app.inject({url:'/api/submissions/'+id,headers:{cookie:admin}})).statusCode,404);assert.equal((await app.inject({url:'/api/submissions/'+id,headers:{cookie:learner}})).statusCode,200);const injection=await app.inject({url:'/api/questions?search='+encodeURIComponent("' OR 1=1 --")});assert.equal(injection.statusCode,200,injection.body);assert.equal(injection.json().total,0);});
test('offline API: immutable versions and mandatory validation before publication',async()=>{const q={...bank[0],title:'Edited title for draft'};const saved=await app.inject({method:'POST',url:'/api/admin/questions',headers:{cookie:admin},payload:q});assert.equal(saved.statusCode,200,saved.body);const state=(await app.inject({url:'/api/admin/questions/q001',headers:{cookie:admin}})).json();assert.equal(state.versions.length,2);assert.equal((await app.inject({method:'POST',url:'/api/admin/versions/'+state.current.id+'/publish',headers:{cookie:admin}})).statusCode,409);assert.equal((await app.inject({url:'/api/questions/q001'})).json().versionId,vid);});
test('offline API: mock reload, owner isolation, frozen expiry and reference unlock',async()=>{
 const r=await app.inject({method:'POST',url:'/api/mocks',headers:{cookie:learner},payload:{count:1,minutes:5,difficulty:'Easy',mode:'timed',dialect:'postgres'}});assert.equal(r.statusCode,200,r.body);const id=r.json().id;const get=()=>app.inject({url:'/api/mocks/'+id,headers:{cookie:learner}});
 const a=(await get()).json(),b=(await get()).json();assert.equal(a.deadline,b.deadline);assert.equal(a.questions[0].solutions,undefined);assert.equal((await app.inject({url:'/api/mocks/'+id,headers:{cookie:admin}})).statusCode,404);assert.equal((await app.inject({url:'/api/questions/q001/solution',headers:{cookie:learner}})).statusCode,403);
 const save=await app.inject({method:'PUT',url:`/api/mocks/${id}/draft`,headers:{cookie:learner},payload:{position:0,query:'SELECT 1'}});assert.equal(save.statusCode,200,save.body);await query("UPDATE mocks SET deadline=now()-interval '1 second' WHERE id=$1",[id]);const ended=(await get()).json();assert.ok(ended.ended_at);assert.ok(ended.questions[0].solutions);assert.equal((await app.inject({method:'PUT',url:`/api/mocks/${id}/draft`,headers:{cookie:learner},payload:{position:0,query:'SELECT 2'}})).statusCode,409);await get();const finals=await query("SELECT * FROM submissions WHERE mock_id=$1 AND mode='final'",[id]);assert.equal(finals.rows.length,1);
});
test('offline API: dashboard derives real counts without invented acceptance',async()=>{const r=await app.inject({url:'/api/dashboard',headers:{cookie:learner}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().solved,0);assert.equal(r.json().accuracy,null);});
