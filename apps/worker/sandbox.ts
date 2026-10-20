import {Pool, type PoolClient} from 'pg';
import type {Dialect,Question,Verdict} from '../../packages/core/question.js';
import {queryPolicy} from '../../packages/core/query-policy.js';

export class JudgeError extends Error {
  constructor(public verdict: Verdict, message: string) {
    super(message); this.name='JudgeError';
  }
}
export type Actual={columns:string[];rows:unknown[][];elapsedMs:number};

const pool = new Pool({
  connectionString: process.env.JUDGE_DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 8000,
  idleTimeoutMillis: 30000,
});

function normalize(value:unknown,typeId:number):unknown {
  if(value==null)return null;
  if(value instanceof Date){
    return typeId===1082 ? value.toISOString().slice(0,10) : value.toISOString().slice(0,19).replace('T',' ');
  }
  if(typeof value==='bigint')return value.toString();
  if(typeof value==='number'&&!Number.isFinite(value))return String(value);
  return value;
}

export async function warmPglite():Promise<void>{
  // Kept as a compatibility export so the existing BullMQ worker needs no change.
  // PostgreSQL starts at service boot; this verifies it is actually query-ready.
  await pool.query('SELECT 1');
  console.info('[native-pg] Prewarmed native PostgreSQL connection');
}
export async function stopWarmPglite():Promise<void>{await pool.end();}

export class Sandbox {
  private client:PoolClient|null=null;
  private question:Question|null=null;
  private testIndex=0;
  constructor(public dialect:Dialect){}
  async start():Promise<void>{
    if(this.dialect!=='postgres')throw new JudgeError('Unsupported Query','Only PostgreSQL is supported.');
    if(!process.env.JUDGE_DATABASE_URL)throw new JudgeError('Internal Judge Error','Judge DB not configured.');
    this.client=await pool.connect();
  }
  async setup(q:Question,index:number):Promise<void>{
    if(!q.tests[index])throw new JudgeError('Internal Judge Error','Dataset not found.');
    this.question=q;this.testIndex=index;
  }
  async query(sql:string):Promise<Actual>{
    if(!this.client||!this.question)throw new JudgeError('Internal Judge Error','Judge not initialized.');
    const blocked=queryPolicy(sql);
    if(blocked)throw new JudgeError('Unsupported Query',blocked);
    const c=this.client;
    let begun=false;
    try {
      // Each dataset executes in an isolated transaction. Rollback removes all DDL/data.
      await c.query('BEGIN');begun=true;
      await c.query("SET LOCAL statement_timeout = '12000ms'");
      await c.query("SET LOCAL lock_timeout = '2500ms'");
      await c.query('DROP SCHEMA IF EXISTS public CASCADE');
      await c.query('CREATE SCHEMA public');
      await c.query(this.question.schema.postgres);
      await c.query(this.question.tests[this.testIndex].setup.postgres);
      const start=performance.now();
      const result=await c.query({text:sql,rowMode:'array'});
      const elapsedMs=Math.round(performance.now()-start);
      if(result.fields.length>30||result.rows.length>1000)
        throw new JudgeError('Resource Limit Exceeded','Query result exceeds allowed limits.');
      return {
        columns:result.fields.map(f=>f.name),
        rows:(result.rows as unknown[][]).map(row=>row.map((val,i)=>normalize(val,result.fields[i].dataTypeID))),
        elapsedMs
      };
    } catch(error) {
      if(error instanceof JudgeError)throw error;
      const e=error as Error & {code?:string};
      if(e.code==='57014')throw new JudgeError('Time Limit Exceeded','PostgreSQL query timed out.');
      throw new JudgeError('Runtime Error',(e.message||'SQL execution failed').slice(0,500));
    } finally {
      if(begun)await c.query('ROLLBACK').catch(()=>{c.release(true);this.client=null;});
    }
  }
  async close():Promise<void>{
    this.question=null;
    if(this.client){this.client.release();this.client=null;}
  }
}
