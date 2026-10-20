import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {questionSchema} from '../packages/core/question.js';
import {judge} from '../apps/worker/judge.js';
const q=questionSchema.parse(JSON.parse(await readFile(new URL('../content/questions.json',import.meta.url),'utf8'))[0]);
const concurrency=Number(process.env.BENCH_CONCURRENCY||2),rounds=Number(process.env.BENCH_ROUNDS||3);let failed=0;
for(const dialect of ['postgres','mysql'] as const){const latencies:number[]=[];for(let r=0;r<rounds;r++)await Promise.all(Array.from({length:concurrency},async()=>{const start=performance.now();const result=await judge(q,dialect,q.solutions[dialect]);latencies.push(performance.now()-start);if(result.verdict!=='Accepted')failed++;}));latencies.sort((a,b)=>a-b);console.log(JSON.stringify({dialect,concurrency,totalRequests:latencies.length,p50Ms:latencies[Math.floor(latencies.length*.5)],p95Ms:latencies[Math.min(latencies.length-1,Math.floor(latencies.length*.95))],failed}));}
if(failed)process.exitCode=1;
