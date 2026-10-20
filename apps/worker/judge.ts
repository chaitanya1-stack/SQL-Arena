import {Sandbox,JudgeError} from './sandbox.js';
import {compare} from '../../packages/core/compare.js';
import {queryPolicy} from '../../packages/core/query-policy.js';
import type {Question,Dialect,Verdict} from '../../packages/core/question.js';
export async function judge(q:Question,dialect:Dialect,sql:string,sampleOnly=false){
 const policy=queryPolicy(sql);if(policy)return {verdict:'Unsupported Query' as Verdict,passed:0,total:sampleOnly?1:q.tests.length,error:policy};
 const box=new Sandbox(dialect);let passed=0;let actual;const tests=q.tests.map((t,i)=>({t,i})).filter(x=>!sampleOnly||!x.t.hidden);let currentHidden=false;
 const start=Date.now();const deadline=setTimeout(()=>void box.close(),Number(process.env.JUDGE_JOB_MS||120000));
 try{await box.start();for(const {t,i} of tests){currentHidden=t.hidden;const setupStart=Date.now();await box.setup(q,i);const setupMs=Date.now()-setupStart;const queryStart=Date.now();const result=await box.query(sql);console.info(`[judge-query] dialect=${dialect} test=${i+1}/${tests.length} setup_ms=${setupMs} query_rpc_ms=${Date.now()-queryStart} sql_ms=${result.elapsedMs} total_ms=${Date.now()-start}`);if(!t.hidden)actual=result;if(!compare(t.expected,result,q.ordered,q.tolerance))return {verdict:'Wrong Answer' as Verdict,passed,total:tests.length,actual,elapsedMs:Date.now()-start};passed++;}
 return {verdict:'Accepted' as Verdict,passed,total:tests.length,actual,elapsedMs:Date.now()-start};
 }catch(e){const known=e instanceof JudgeError;return {verdict:known?e.verdict:'Internal Judge Error' as Verdict,passed,total:tests.length,actual,error:known?(currentHidden&&e.verdict!=='Internal Judge Error'?'The query failed on a hidden dataset.':e.message):'The judge could not complete this request.',elapsedMs:Date.now()-start};}
 finally{clearTimeout(deadline);await box.close();}
}
export async function validateQuestion(q:Question){
 const report:Record<string,unknown>={};let passed=true;
 for(const dialect of ['postgres','mysql'] as const){const outcome=await judge(q,dialect,q.solutions[dialect]);report[dialect]=outcome;passed&&=outcome.verdict==='Accepted';}
 return {passed,engines:['postgres','mysql'],checkedAt:new Date().toISOString(),report};
}
