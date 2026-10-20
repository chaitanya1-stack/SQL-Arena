import {randomUUID} from 'node:crypto';
import {db,transaction} from './db.js';
export async function finishMock(id:string,userId?:string){return transaction(async c=>{
 const {rows}=await c.query('SELECT * FROM mocks WHERE id=$1 FOR UPDATE',[id]);const m=rows[0];
 if(!m||userId&&m.user_id!==userId)throw Object.assign(new Error('Assessment not found.'),{statusCode:404});
 if(m.ended_at)return;
 await c.query('UPDATE mocks SET ended_at=LEAST(now(),deadline) WHERE id=$1',[id]);
 const questions=await c.query('SELECT * FROM mock_questions WHERE mock_id=$1 ORDER BY position',[id]);
 for(const q of questions.rows)if(q.draft.trim())await c.query("INSERT INTO submissions(id,user_id,version_id,mock_id,position,query,dialect,mode) VALUES($1,$2,$3,$4,$5,$6,$7,'final') ON CONFLICT DO NOTHING",[randomUUID(),m.user_id,q.version_id,id,q.position,q.draft,m.dialect]);
 });}
