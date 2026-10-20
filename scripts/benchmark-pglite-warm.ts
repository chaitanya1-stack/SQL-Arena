import {readFileSync} from 'node:fs';
import {judge} from '../apps/worker/judge.js';
import {warmPglite,stopWarmPglite} from '../apps/worker/sandbox.js';
import {performance} from 'node:perf_hooks';

const q=JSON.parse(readFileSync(new URL('../content/questions.json',import.meta.url),'utf8'))[0];
try {
  for(let i=1;i<=3;i++){
    console.time(`Warmup ${i}`);
    await warmPglite();
    console.timeEnd(`Warmup ${i}`);
    const start=performance.now();
    const result=await judge(q,'postgres',q.solutions.postgres,false);
    const duration=Math.round(performance.now()-start);
    console.log(JSON.stringify({run:i,verdict:result.verdict,passed:result.passed,total:result.total,elapsedMs:duration}));
    if(result.verdict!=='Accepted'||result.passed!==result.total)process.exitCode=1;
  }
}finally{
  await stopWarmPglite();
}
