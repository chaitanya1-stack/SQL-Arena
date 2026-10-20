import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {judge,validateQuestion} from '../apps/worker/judge.js';
import {questionSchema} from '../packages/core/question.js';
const bank=JSON.parse(readFileSync(new URL('../content/questions.json',import.meta.url),'utf8'));
test('PGlite validates sample and hidden datasets', {timeout:120000}, async()=>{
 const q=questionSchema.parse(bank[0]);
 const result=await validateQuestion(q);
 assert.equal(result.postgresCompatible,true);
 assert.equal(result.report.postgres.verdict,'Accepted');
 assert.equal(result.report.postgres.passed,q.tests.length);
});
test('PGlite rejects non-read-only statement', {timeout:30000}, async()=>{
 const q=questionSchema.parse(bank[0]);
 assert.equal((await judge(q,'postgres','DELETE FROM customers',true)).verdict,'Unsupported Query');
 assert.equal((await judge(q,'mysql',q.solutions.mysql,true)).verdict,'Unsupported Query');
});
