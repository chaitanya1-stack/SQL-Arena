import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import type {Dialect,Question,Verdict} from '../../packages/core/question.js';
import {queryPolicy} from '../../packages/core/query-policy.js';
export class JudgeError extends Error{constructor(public verdict:Verdict,message:string){super(message);}}
export type Actual={columns:string[],rows:unknown[][],elapsedMs:number};
export function command(args:string[],input='',timeout=15000,limit=1200000):Promise<string>{return new Promise((resolve,reject)=>{
  const proc=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='',bytes=0,done=false;
  const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(out);};
  const timer=setTimeout(()=>{proc.kill('SIGKILL');finish(new JudgeError('Time Limit Exceeded','Execution exceeded its time limit.'));},timeout);
  proc.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>limit){proc.kill('SIGKILL');finish(new JudgeError('Resource Limit Exceeded','Output exceeds the limit.'));}else out+=chunk.toString();});
  proc.stderr.on('data',(chunk:Buffer)=>{if(err.length<16000)err+=chunk.toString();});
  proc.on('error',()=>finish(new JudgeError('Internal Judge Error','Docker is unavailable to the judge worker.')));
  proc.on('close',code=>finish(code===0?undefined:new JudgeError('Internal Judge Error',`Container operation failed (${code}).`)));
  proc.stdin.on('error',()=>{});proc.stdin.end(input);
});}
export class Sandbox{
  name='arena-'+randomUUID();password=randomBytes(24).toString('hex');reader=randomBytes(24).toString('hex');
  constructor(public dialect:Dialect){}
  async start(){
    const pg=this.dialect==='postgres',image=pg?(process.env.JUDGE_POSTGRES_IMAGE||'sql-arena-postgres'):(process.env.JUDGE_MYSQL_IMAGE||'sql-arena-mysql');
    const args=['run','-d','--name',this.name,'--label','sql-arena.sandbox=true','--network','none','--memory','512m','--memory-swap','512m','--cpus','0.5','--pids-limit','128','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user',pg?'postgres':'mysql','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--tmpfs',pg?'/var/lib/postgresql/data:rw,nosuid,size=256m,uid=999,gid=999,mode=0700':'/var/lib/mysql:rw,nosuid,size=384m,uid=999,gid=999,mode=0700','--tmpfs',pg?'/var/run/postgresql:rw,noexec,nosuid,uid=999,gid=999':'/var/run/mysqld:rw,noexec,nosuid,uid=999,gid=999','-e',pg?`POSTGRES_PASSWORD=${this.password}`:`MYSQL_ROOT_PASSWORD=${this.password}`];
    if(pg)args.push('-e','POSTGRES_DB=arena','-e','POSTGRES_INITDB_ARGS=--auth-local=scram-sha-256');else args.push('-e','MYSQL_DATABASE=arena');
    args.push(image);if(!pg)args.push('--skip-log-bin','--local-infile=0','--secure-file-priv=NULL','--innodb-buffer-pool-size=64M','--innodb-redo-log-capacity=16M','--innodb-log-buffer-size=8M','--tmp-table-size=8M','--max-heap-table-size=8M','--performance-schema=OFF','--mysqlx=OFF','--max-connections=8','--skip-name-resolve');
    const attempts=Math.max(1,Math.min(2,Number(process.env.JUDGE_START_ATTEMPTS||2)));
    for(let attempt=1;attempt<=attempts;attempt++){
      const bootStarted=Date.now();
      let createdMs=0;let checks=0;let lastError='No readiness response';
      try{
        await command(args,'',20000);
        createdMs=Date.now()-bootStarted;
        const deadline=Date.now()+Number(process.env.JUDGE_READY_MS||45000);
        while(Date.now()<deadline){
          checks++;
          try{
            await this.rpc({action:'ready'});
            console.info(`[judge-start] dialect=${this.dialect} attempt=${attempt} docker_ms=${createdMs} ready_ms=${Date.now()-bootStarted-createdMs} checks=${checks}`);
            return;
          }catch(e){lastError=e instanceof Error?e.message:String(e);await new Promise(r=>setTimeout(r,400));}
        }
        throw new JudgeError('Internal Judge Error','Database sandbox failed to initialize.');
      }catch(e){
        const inspection=await command(['inspect','--format','{{json .State}}',this.name],'',3000).catch(()=>null);
        const logs=await command(['logs','--tail','20',this.name],'',3000).catch(()=>null);
        console.error(`[judge-start-failed] dialect=${this.dialect} attempt=${attempt}/${attempts} total_ms=${Date.now()-bootStarted} docker_ms=${createdMs} checks=${checks} error=${e instanceof Error?e.message:String(e)} last_ready_error=${lastError} state=${inspection?.slice(0,900)||'unavailable'} logs=${logs?.slice(0,900)||'unavailable'}`);
        await this.close();
        if(attempt===attempts)throw new JudgeError('Internal Judge Error','Database sandbox failed to initialize.');
        await new Promise(r=>setTimeout(r,1000));
      }
    }
  }
  async rpc(extra:Record<string,unknown>):Promise<Actual>{
    let raw:string;
    try{raw=await command(['exec','-i',this.name,'node','/arena-runner/run.cjs'],JSON.stringify({dialect:this.dialect,password:this.password,reader:this.reader,ms:Number(process.env.JUDGE_QUERY_MS||3000),...extra}),extra.action==='query'?Number(process.env.JUDGE_QUERY_MS||3000)+5000:20000);}
    catch(e){if(extra.action==='query'&&e instanceof JudgeError&&e.verdict==='Internal Judge Error'){
      const inspection=await command(['inspect',this.name]).catch(()=>null);
      if(inspection&&JSON.parse(inspection)[0]?.State?.OOMKilled)throw new JudgeError('Resource Limit Exceeded','The database reached its memory limit.');
    }throw e;}
    let response;try{response=JSON.parse(raw);}catch{throw new JudgeError('Internal Judge Error','The database returned an invalid judge response.');}
    if(response.error)throw new JudgeError(response.verdict,response.error);return response;
  }
  async setup(q:Question,index:number){await this.rpc({action:'setup',schema:q.schema[this.dialect],setup:q.tests[index].setup[this.dialect]});}
  async query(sql:string){const error=queryPolicy(sql);if(error)throw new JudgeError('Unsupported Query',error);return this.rpc({action:'query',sql});}
  async close(){await command(['rm','-f',this.name],'',10000).catch(()=>{});}
}
