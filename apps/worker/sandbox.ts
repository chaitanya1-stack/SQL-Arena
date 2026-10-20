import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import type {Dialect,Question,Verdict} from '../../packages/core/question.js';
import {queryPolicy} from '../../packages/core/query-policy.js';

export class JudgeError extends Error {
 constructor(public verdict:Verdict,message:string){super(message);this.name='JudgeError';}
}
export type Actual={columns:string[];rows:unknown[][];elapsedMs:number};
type Reply={type:'ready'|'result'|'fatal';columns?:string[];rows?:unknown[][];elapsedMs?:number;verdict?:Verdict;error?:string};
const RUNNER=fileURLToPath(new URL('./pglite-runner.ts',import.meta.url));
const READY_TIMEOUT_MS=45_000;
const TEST_TIMEOUT_MS=12_000;
const MAX_OUTPUT_BYTES=1_200_000;

class Runner {
 child:ChildProcessWithoutNullStreams;
 private waiting:((response:Reply)=>void)|null=null;
 private rejecting:((reason:Error)=>void)|null=null;
 private ready:Promise<void>;
 private started=false;
 private dead=false;
 private bytes=0;
 constructor(){
  this.child=spawn(process.execPath,['--max-old-space-size=256','--import','tsx',RUNNER],{
   stdio:['pipe','pipe','pipe'],
   env:{PATH:process.env.PATH||'',NODE_ENV:'production'}
  });
  const lines=createInterface({input:this.child.stdout});
  lines.on('line',line=>{
   this.bytes+=Buffer.byteLength(line,'utf8');
   if(this.bytes>MAX_OUTPUT_BYTES){this.fail(new JudgeError('Resource Limit Exceeded','Runner output too large.'));return;}
   try{const response=JSON.parse(line) as Reply;this.waiting?.(response);}catch{this.fail(new JudgeError('Internal Judge Error','Malformed runner response.'));}
  });
  this.child.stderr.on('data', (chunk: Buffer) => {
    console.error(
      '[pglite-child-stderr]',
      chunk.toString('utf8').slice(0, 1500)
    );
  });

  console.info('[pglite] child spawned pid=' + this.child.pid); // Drain stderr without exposing SQL or credentials.
  this.child.on('error',()=>this.fail(new JudgeError('Internal Judge Error','PGlite process could not start.')));
  this.child.on('close', (code, signal) => {
    console.error(
      `[pglite] child exited code=${code} signal=${signal}`
    );

    this.fail(
      new JudgeError(
        'Internal Judge Error',
        'PGlite runner stopped unexpectedly.'
      )
    );
  });
  this.child.stdin.on('error',()=>{});
  this.ready=this.request(undefined,READY_TIMEOUT_MS).then(response=>{
   if(response.type!=='ready')throw new JudgeError('Internal Judge Error','Runner not ready.');
   this.started=true;
  });
 }
 private fail(error:Error){if(this.dead)return;this.dead=true;this.child.kill('SIGKILL');this.rejecting?.(error);}
 private request(payload:object|undefined,timeout:number):Promise<Reply>{
  if(this.dead)return Promise.reject(new JudgeError('Internal Judge Error','Runner unavailable.'));
  if(this.waiting)return Promise.reject(new JudgeError('Internal Judge Error','Runner is busy.'));
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>this.fail(new JudgeError('Time Limit Exceeded',payload?'PostgreSQL query/test exceeded its time limit.':'PGlite startup timed out.')),timeout);
   this.waiting=response=>{clearTimeout(timer);this.waiting=null;this.rejecting=null;resolve(response);};
   this.rejecting=error=>{clearTimeout(timer);this.waiting=null;this.rejecting=null;reject(error);};
   if(payload)this.child.stdin.write(JSON.stringify(payload)+'\n');
  });
 }
 async initialized(){await this.ready;}
 async test(data:object):Promise<Reply>{await this.initialized();this.bytes=0;return this.request(data,TEST_TIMEOUT_MS);}
 kill(){this.dead=true;this.child.kill('SIGKILL');}
}

// Reserve one initialized process at a time. Never reuse it across submissions.
let prewarm:Promise<Runner>|null=null;
let readyAt=0;
function newWarm():Promise<Runner>{
 const t=Date.now();
 const runner=new Runner();
 return runner.initialized().then(()=>{
  readyAt=Date.now();
  console.info(`[pglite] runner ready startup_ms=${readyAt-t}`);
  return runner;
 }).catch(e=>{runner.kill();throw e;});
}
export function warmPglite():Promise<void>{
 if(!prewarm){prewarm=newWarm();prewarm.catch(()=>{if(prewarm===currentWarm)prewarm=null;});}
 const currentWarm=prewarm;
 return currentWarm.then(()=>{});
}
async function checkout():Promise<Runner>{
 const t=Date.now();
 const wasPrewarmed=prewarm!==null;
 const runnerPromise=prewarm||newWarm();prewarm=null;
 const runner=await runnerPromise;
 console.info(`[pglite] checkout prewarmed=${wasPrewarmed} wait_ms=${Date.now()-t} ready_age_ms=${wasPrewarmed?Date.now()-readyAt:0}`);
 return runner;
}
export async function stopWarmPglite():Promise<void>{
 const spare=prewarm;
 prewarm=null;
 if(spare){try{(await spare).kill();}catch{/* prewarm already failed */}}
}

export class Sandbox {
 private runner:Runner|null=null;
 private question:Question|null=null;
 private testIndex=0;
 constructor(public dialect:Dialect){}
 async start():Promise<void>{
  if(this.dialect!=='postgres')throw new JudgeError('Unsupported Query','Only PostgreSQL is supported.');
  this.runner=await checkout();
 }
 async setup(q:Question,index:number):Promise<void>{
  if(!q.tests[index])throw new JudgeError('Internal Judge Error','Dataset not found.');
  this.question=q;this.testIndex=index;
 }
 async query(sql:string):Promise<Actual>{
  if(!this.runner||!this.question)throw new JudgeError('Internal Judge Error','Runner not initialized.');
  const error=queryPolicy(sql);if(error)throw new JudgeError('Unsupported Query',error);
  const result=await this.runner.test({schema:this.question.schema.postgres,setup:this.question.tests[this.testIndex].setup.postgres,sql});
  if(result.verdict||result.error)throw new JudgeError(result.verdict||'Runtime Error',result.error||'Execution failed.');
  if(!Array.isArray(result.columns)||!Array.isArray(result.rows))throw new JudgeError('Internal Judge Error','Invalid runner result.');
  return {columns:result.columns,rows:result.rows,elapsedMs:result.elapsedMs||0};
 }
 async close():Promise<void>{
  this.question=null;
  this.runner?.kill();this.runner=null;
  // Prepare the next runner without blocking the current verdict.
  if(process.env.PGLITE_PILOT==='true')void warmPglite().catch(()=>{});
 }
}
