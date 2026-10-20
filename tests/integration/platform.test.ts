// Requires disposable PostgreSQL + Redis. Never point this at production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
process.env.ARENA_TEST='true';
const {buildApp}=await import('../../apps/api/server.js');
const {db}=await import('../../apps/api/db.js');
const {contentHash}=await import('../../packages/core/content-hash.js');
const app=await buildApp();const origin=process.env.APP_ORIGIN||'http://localhost:3000';
const bank=JSON.parse(readFileSync(new URL('../../content/questions.json',import.meta.url),'utf8'));
const emails:string[]=[];let userCookie='',adminCookie='',userId='',versionId='';
test.before(async()=>{
 for(const admin of [false,true]){const email=`integration-${randomUUID()}@example.invalid`;emails.push(email);await app.inject({method:'POST',url:'/api/auth/register',headers:{origin},payload:{email,password:'integration-test-only-123',name:admin?'Admin':'Learner'}});const u=(await db.query('SELECT id FROM users WHERE email=$1',[email])).rows[0];if(admin)await db.query("UPDATE users SET role='admin' WHERE id=$1",[u.id]);else userId=u.id;const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin},payload:{email,password:'integration-test-only-123'}});assert.equal(login.statusCode,200);const cookie=login.cookies.map(c=>`${c.name}=${c.value}`).join('; ');if(admin)adminCookie=cookie;else userCookie=cookie;}
 const q={...bank[0],id:'q900001',slug:'integration-only-question'};versionId=randomUUID();await db.query('INSERT INTO questions(id,slug,title,difficulty,topics,companies,minutes,published_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[q.id,q.slug,q.title,q.difficulty,q.topics,q.companies,q.minutes,versionId]);await db.query("INSERT INTO question_versions(id,question_id,version,body,content_hash,validation_status) VALUES($1,$2,1,$3,$4,'passed')",[versionId,q.id,JSON.stringify(q),contentHash(q)]);
});
test.after(async()=>{await db.query('DELETE FROM users WHERE email=ANY($1)',[emails]);await db.query("DELETE FROM questions WHERE id='q900001'");await app.close();});
test('admin API rejects ordinary users and missing sessions',async()=>{for(const cookie of ['',userCookie])assert.equal((await app.inject({url:'/api/admin/questions',headers:{cookie}})).statusCode,403);assert.equal((await app.inject({url:'/api/admin/questions',headers:{cookie:adminCookie}})).statusCode,200);});
test('mutations reject absent or foreign origins',async()=>{for(const headers of [{cookie:userCookie},{cookie:userCookie,origin:'https://attacker.invalid'}])assert.equal((await app.inject({method:'POST',url:'/api/auth/logout',headers})).statusCode,403);});
test('public retrieval strips reference SQL, hidden data and setup SQL',async()=>{const r=await app.inject({url:'/api/questions/q900001'});assert.equal(r.statusCode,200);const q=r.json();assert.equal(q.tests.length,1);assert.ok(!q.solutions);assert.ok(!q.tests[0].setup);});
test('question filters and search are parameterized',async()=>{const r=await app.inject({url:'/api/questions?search='+encodeURIComponent("' OR 1=1 --"),headers:{cookie:userCookie}});assert.equal(r.statusCode,200);assert.equal(r.json().total,0);});
test('submission data is private to its owner',async()=>{const id=randomUUID();await db.query("INSERT INTO submissions(id,user_id,version_id,query,dialect,mode) VALUES($1,$2,$3,'SELECT 1','postgres','run')",[id,userId,versionId]);assert.equal((await app.inject({url:'/api/submissions/'+id,headers:{cookie:userCookie}})).statusCode,200);assert.equal((await app.inject({url:'/api/submissions/'+id,headers:{cookie:adminCookie}})).statusCode,404);});
test('mock deadline survives reload and expiry freezes drafts',async()=>{
 const created=await app.inject({method:'POST',url:'/api/mocks',headers:{origin,cookie:userCookie},payload:{count:1,minutes:5,difficulty:'Easy',mode:'timed',dialect:'postgres'}});assert.equal(created.statusCode,200);const id=created.json().id;
 const get=()=>app.inject({url:'/api/mocks/'+id,headers:{cookie:userCookie}});const a=(await get()).json(),b=(await get()).json();assert.equal(a.deadline,b.deadline);assert.ok(!a.questions[0].solutions);
 const q=a.questions[0];const solution=await app.inject({url:'/api/questions/'+q.body.id+'/solution',headers:{cookie:userCookie}});assert.equal(solution.statusCode,403);
 const saved=await app.inject({method:'PUT',url:`/api/mocks/${id}/draft`,headers:{origin,cookie:userCookie},payload:{position:0,query:'SELECT 1'}});assert.equal(saved.statusCode,200);
 await db.query("UPDATE mocks SET deadline=now()-interval '1 second' WHERE id=$1",[id]);const ended=(await get()).json();assert.ok(ended.ended_at);assert.equal(ended.questions[0].draft,'SELECT 1');assert.ok(ended.questions[0].solutions);
 assert.equal((await app.inject({method:'PUT',url:`/api/mocks/${id}/draft`,headers:{origin,cookie:userCookie},payload:{position:0,query:'SELECT 2'}})).statusCode,409);
 await get();const rows=await db.query("SELECT * FROM submissions WHERE mock_id=$1 AND mode='final'",[id]);assert.equal(rows.rowCount,1);
});
