import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {judge} from '../../apps/worker/judge.js';
import {Sandbox,command} from '../../apps/worker/sandbox.js';
import {questionSchema} from '../../packages/core/question.js';
const bank=JSON.parse(readFileSync(new URL('../../content/questions.json',import.meta.url),'utf8'));
for(const dialect of ['postgres','mysql'] as const){
 test(`${dialect}: real reference executes and hardcoded sample answer fails hidden dataset`,{timeout:300000},async()=>{const q=questionSchema.parse(bank[1]);assert.equal((await judge(q,dialect,q.solutions[dialect])).verdict,'Accepted');const wrong=await judge(q,dialect,`SELECT ${q.tests[0].expected.rows[0][0]} AS completed_revenue`);assert.equal(wrong.verdict,'Wrong Answer');assert.equal(wrong.passed,1);});
 test(`${dialect}: readonly privileges, denied secrets, network isolation and query limits`,{timeout:180000},async()=>{const box=new Sandbox(dialect);try{await box.start();const q=questionSchema.parse(bank[0]);await box.setup(q,0);const inspection=JSON.parse(await command(['inspect',box.name]))[0];assert.equal(inspection.HostConfig.NetworkMode,'none');assert.equal(inspection.HostConfig.ReadonlyRootfs,true);assert.equal(inspection.HostConfig.Memory,512*1024*1024);await assert.rejects(box.rpc({action:'query',sql:'DELETE FROM customers'}));await assert.rejects(box.query(dialect==='postgres'?'SELECT rolpassword FROM pg_authid':'SELECT authentication_string FROM mysql.user'));await assert.rejects(box.query(dialect==='postgres'?'SELECT pg_sleep(10)':'SELECT SLEEP(10)'));}finally{await box.close();}});
}
