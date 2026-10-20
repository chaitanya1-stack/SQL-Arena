import {Worker,Queue} from 'bullmq';
import {cleanupOrphans} from './cleanup.js';
import {Redis} from 'ioredis';
import {db} from '../api/db.js';
import {finishMock} from '../api/mocks.js';
import {judge,validateQuestion} from './judge.js';
import {questionSchema} from '../../packages/core/question.js';
import {contentHash} from '../../packages/core/content-hash.js';
const connection=new Redis(process.env.REDIS_URL||'redis://localhost:6379',{maxRetriesPerRequest:null});
const queue=new Queue('sql-arena',{connection});
const worker=new Worker('sql-arena',async job=>{
 if(job.name==='validate'){
  const {rows}=await db.query("UPDATE question_versions SET validation_status='running',validation_started_at=now() WHERE id=$1 AND validation_status='queued' RETURNING *",[job.data.id]);const v=rows[0];if(!v)return;
  try{const q=questionSchema.parse(v.body);if(contentHash(q)!==v.content_hash)throw new Error('Content hash mismatch');const report=await validateQuestion(q);await db.query('UPDATE question_versions SET validation_status=$1,validation_report=$2 WHERE id=$3',[report.passed?'passed':'failed',JSON.stringify(report),v.id]);}
  catch{await db.query("UPDATE question_versions SET validation_status='failed',validation_report=$1 WHERE id=$2",[JSON.stringify({error:'Validation infrastructure failed. Retry validation.'}),v.id]);}
  return;
 }
 const {rows}=await db.query("UPDATE submissions SET state='running',started_at=now() WHERE id=$1 AND state='queued' RETURNING *",[job.data.id]);const s=rows[0];if(!s)return;
 try{
  const v=(await db.query('SELECT body FROM question_versions WHERE id=$1',[s.version_id])).rows[0];
  const result=await judge(questionSchema.parse(v.body),s.dialect,s.query,s.mode==='run');
  if(result.verdict==='Internal Judge Error'&&job.attemptsMade<1){await db.query("UPDATE submissions SET state='queued' WHERE id=$1",[s.id]);throw new Error('Retry infrastructure failure');}
  await db.query("UPDATE submissions SET state='done',verdict=$1,result=$2,finished_at=now() WHERE id=$3",[result.verdict,JSON.stringify(result),s.id]);
 }catch(e){if((e as Error).message==='Retry infrastructure failure')throw e;await db.query("UPDATE submissions SET state='done',verdict='Internal Judge Error',result=$1,finished_at=now() WHERE id=$2",[JSON.stringify({error:'The judge could not complete this request. Please retry.'}),s.id]);}
},{connection,concurrency:Math.max(1,Math.min(16,Number(process.env.JUDGE_CONCURRENCY||2))),lockDuration:180000});
worker.on('error',()=>console.error('Worker connection error; retrying.'));
let dispatching=false,lastCleanup=0;
async function dispatch(){if(dispatching)return;dispatching=true;try{
 if(Date.now()-lastCleanup>60000){lastCleanup=Date.now();await cleanupOrphans().catch(()=>{});await db.query("UPDATE question_versions SET validation_status='failed',validation_report='{\"error\":\"Validation worker stopped; retry validation.\"}' WHERE validation_status='running' AND validation_started_at<now()-interval '5 minutes'");}
 // The database is the durable outbox. Redis outages cannot lose accepted work.
 const expired=await db.query('SELECT id FROM mocks WHERE ended_at IS NULL AND deadline<=now() LIMIT 50');for(const m of expired.rows)await finishMock(m.id);
 await db.query("UPDATE submissions SET state='done',verdict='Internal Judge Error',result='{\"error\":\"The worker stopped before completing this request. Please retry.\"}',finished_at=now() WHERE state='running' AND started_at<now()-interval '5 minutes'");
 const pending=await db.query("SELECT id FROM submissions WHERE state='queued' ORDER BY created_at LIMIT 100");for(const s of pending.rows)await queue.add('submission',{id:s.id},{jobId:s.id,attempts:2,backoff:{type:'exponential',delay:1000},removeOnComplete:{age:86400,count:10000},removeOnFail:{age:86400}});
 const validations=await db.query("SELECT id FROM question_versions WHERE validation_status='queued' LIMIT 10");for(const v of validations.rows)await queue.add('validate',{id:v.id},{jobId:'validate-'+v.id,removeOnComplete:true,removeOnFail:true});
 await db.query('DELETE FROM sessions WHERE expires_at<now()');await db.query('DELETE FROM auth_tokens WHERE expires_at<now()');
 await db.query("DELETE FROM users WHERE role='guest' AND created_at<now()-interval '30 days'");
 }catch{console.error('Dispatch paused; database or queue unavailable.');}finally{dispatching=false;}}
const timer=setInterval(()=>void dispatch(),2000);await dispatch();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{clearInterval(timer);await worker.close();await queue.close();await connection.quit();await db.end();process.exit(0);});
