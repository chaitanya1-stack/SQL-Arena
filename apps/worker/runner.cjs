'use strict';
// This program lives INSIDE the networkless, disposable database container.
const {performance}=require('node:perf_hooks');
let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>run(JSON.parse(input)));
async function run(p){
 let c;const pg=p.dialect==='postgres',reader=p.action==='query',start=performance.now();
 try{
  if(pg){const {Client,types}=require('pg');types.setTypeParser(1082,x=>x);types.setTypeParser(1114,x=>x);types.setTypeParser(1184,x=>x);c=new Client({host:'/var/run/postgresql',database:'arena',user:reader?'learner':'postgres',password:reader?p.reader:p.password,connectionTimeoutMillis:3000});await c.connect();}
  else {c=require('mysql2').createConnection({socketPath:'/var/run/mysqld/mysqld.sock',database:'arena',user:reader?'learner':'root',password:reader?p.reader:p.password,multipleStatements:!reader,rowsAsArray:true,supportBigNumbers:true,bigNumberStrings:true,dateStrings:true,connectTimeout:3000});await new Promise((res,rej)=>c.connect(e=>e?rej(e):res()));}
  const exec=async sql=>pg?c.query(sql):c.promise().query(sql);
  if(p.action==='ready'){await exec('SELECT 1');return output({ok:true});}
  if(p.action==='setup'){
    if(pg){await exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE ALL ON SCHEMA public FROM PUBLIC; REVOKE TEMPORARY ON DATABASE arena FROM PUBLIC;');await exec(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='learner') THEN CREATE ROLE learner LOGIN PASSWORD '${p.reader}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF; END $$;`);await exec(p.schema);await exec(p.setup);await exec('GRANT USAGE ON SCHEMA public TO learner; GRANT SELECT ON ALL TABLES IN SCHEMA public TO learner;');}
    else{await exec('DROP DATABASE IF EXISTS arena; CREATE DATABASE arena; USE arena;');await exec(`CREATE USER IF NOT EXISTS 'learner'@'localhost' IDENTIFIED BY '${p.reader}'; GRANT SELECT ON arena.* TO 'learner'@'localhost';`);await exec(p.schema);await exec(p.setup);}
    return output({ok:true});
  }
  if(p.action!=='query')throw new Error('Invalid action');
  let rows=[],columns=[],bytes=0;
  function add(row){if(rows.length>=1000)throw Object.assign(new Error('Result exceeds 1,000 rows.'),{arena:'Resource Limit Exceeded'});bytes+=Buffer.byteLength(JSON.stringify(row));if(bytes>1000000)throw Object.assign(new Error('Result exceeds 1 MB.'),{arena:'Resource Limit Exceeded'});rows.push(row);}
  if(pg){
    await exec('BEGIN READ ONLY');await exec(`SET LOCAL statement_timeout=${Number(p.ms)}; SET LOCAL lock_timeout=500; SET LOCAL work_mem='8MB';`);
    const Cursor=require('pg-cursor');const cursor=c.query(new Cursor(p.sql,[],{rowMode:'array'}));
    const batch=await new Promise((res,rej)=>cursor.read(1001,(e,r)=>e?rej(e):res(r)));columns=cursor._result.fields.map(f=>f.name);batch.forEach(add);await new Promise((res,rej)=>cursor.close(e=>e?rej(e):res()));await exec('ROLLBACK');
  }else{
    await exec(`SET SESSION max_execution_time=${Number(p.ms)}`);await exec('START TRANSACTION READ ONLY');
    await new Promise((res,rej)=>{const query=c.query(p.sql);query.on('fields',fields=>columns=fields.map(f=>f.name));query.on('result',row=>{try{add(row);}catch(e){c.destroy();rej(e);}});query.on('error',rej);query.on('end',res);});await exec('ROLLBACK');
  }
  output({columns,rows,elapsedMs:Math.round(performance.now()-start)});
 }catch(e){const syntax=pg?e.code==='42601':e.code==='ER_PARSE_ERROR';const timeout=['57014','ER_QUERY_TIMEOUT','ER_QUERY_INTERRUPTED'].includes(e.code);const verdict=e.arena||(timeout?'Time Limit Exceeded':syntax?'Syntax Error':p.action==='query'?'Runtime Error':'Internal Judge Error');output({error:p.action==='query'?String(e.message).slice(0,800):'Sandbox initialization failed.',verdict});}
 finally{if(c){try{if(pg)await c.end();else c.destroy();}catch{}}}
}
function output(value){process.stdout.write(JSON.stringify(value));}
