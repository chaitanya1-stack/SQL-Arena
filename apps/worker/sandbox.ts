import {Worker} from 'node:worker_threads';
import type {Dialect,Question,Verdict} from '../../packages/core/question.js';
import {queryPolicy} from '../../packages/core/query-policy.js';

export class JudgeError extends Error {
 constructor(public verdict:Verdict,message:string){super(message);this.name='JudgeError';}
}
export type Actual={columns:string[];rows:unknown[][];elapsedMs:number};
type Reply={type:'ready'|'result'|'fatal';columns?:string[];rows?:unknown[][];elapsedMs?:number;verdict?:Verdict;error?:string};
const THREAD=new URL('./pglite-thread.ts',import.meta.url);
const READY_TIMEOUT_MS=90_000;
const TEST_TIMEOUT_MS=12_000;
const MAX_OUTPUT_BYTES=1_200_000;

class Runner {
 private thread:Worker;
 private waiting:((response:Reply)=>void)|null=null;
 private rejecting:((reason:Error)=>void)|null=null;
 private ready:Promise<void>;
 private dead=false;
 constructor(){
  this.thread=new Worker(THREAD, {
   execArgv:['--import','tsx'],
   env:{NODE_ENV:'production',PATH:process.env.PATH||''},
   resourceLimits:{maxOldGenerationSizeMb:160}
  });
  this.thread.on('message',(response:Reply)=>{
   // Message size is bounded even for successfully executed queries.
   if(Buffer.byteLength(JSON.stringify(response),'utf8')>MAX_OUTPUT_BYTES){
    this.fail(new JudgeError('Resource Limit Exceeded','Runner output too large.'));return;
   }
   this.waiting?.(response);
  });
  this.thread.on('error',(error)=>{
   console.error('[pglite] worker thread error:',error.message);
   this.fail(new JudgeError('Internal Judge Error','PGlite worker thread error.'));
  });
  this.thread.on('exit',(code)=>{
   if(!this.dead){
    console.error('[pglite] worker thread exited code='+code);
    this.fail(new JudgeError('Internal Judge Error','PGlite worker stopped unexpectedly.'));
   }
  });
  console.info('[pglite] worker thread created');
  this.ready=this.request(undefined,READY_TIMEOUT_MS).then(response=>{
   if(response.type!=='ready')throw new JudgeError('Internal Judge Error',response.error||'Runner not ready.');
  });
 }
 private fail(error:Error){
  if(this.dead)return;
  this.dead=true;
  void this.thread.terminate();
  this.rejecting?.(error);
 }
 private request(payload:string|undefined, timeout:number):Promise<Reply>{
  if(this.dead)return Promise.reject(new JudgeError('Internal Judge Error','Runner unavailable.'));
  if(this.waiting)return Promise.reject(new JudgeError('Internal Judge Error','Runner is busy.'));
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>this.fail(new JudgeError('Time Limit Exceeded',payload?'PostgreSQL test timed out.':'PGlite startup timed out.')),timeout);
   this.waiting=response=>{clearTimeout(timer);this.waiting=null;this.rejecting=null;resolve(response);};
   this.rejecting=error=>{clearTimeout(timer);this.waiting=null;this.rejecting=null;reject(error);};
   if(payload!==undefined)this.thread.postMessage(payload);
  });
 }
 async initialized(){await this.ready;}
 async test(data:object):Promise<Reply>{await this.initialized();return this.request(JSON.stringify(data),TEST_TIMEOUT_MS);}
 isDead(){return this.dead;}
 kill(){this.dead=true;void this.thread.terminate();}
}

// At most one WASM instance is resident. It is reused across submissions,
// resetting the public schema before each dataset. Only for trusted admin pilot.
let warm:Promise<Runner>|null=null;
let checkedOut=false;
function makeRunner():Promise<Runner>{
 const began=Date.now();
 const runner=new Runner();
 return runner.initialized().then(()=>{
  console.info('[pglite] runner ready startup_ms='+(Date.now()-began));
  return runner;
 }).catch(e=>{runner.kill();throw e;});
}
export function warmPglite():Promise<void>{
 if(!warm){
  const pending=makeRunner();
  warm=pending;
  void pending.catch(()=>{if(warm===pending)warm=null;});
 }
 return warm.then(()=>{});
}
async function checkout():Promise<Runner>{
 if(checkedOut)throw new JudgeError('Internal Judge Error','Single judge runner is busy.');
 checkedOut=true;
 try{
  if(!warm)warm=makeRunner();
  const runner=await warm;
  console.info('[pglite] checked out warm worker thread');
  return runner;
 }catch(error){checkedOut=false;warm=null;throw error;}
}
export async function stopWarmPglite():Promise<void>{
 const pending=warm;
 warm=null;
 checkedOut=false;
 if(pending)try{(await pending).kill();}catch{/* runner initialization failed */}
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
  if(this.runner?.isDead()){
   warm=null;
  }
  this.runner=null;
  checkedOut=false;
  // Do not spawn a second worker. The current worker is already prewarmed.
  // On failure, restart one runner after the previous one has exited.
  if(!warm&&process.env.PGLITE_PREWARM==='true')void warmPglite().catch(()=>{});
 }
}
