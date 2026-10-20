import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import {Redis} from 'ioredis';
import {Queue} from 'bullmq';
import {ZodError} from 'zod';
import {db} from './db.js';
import {startWorker} from '../worker/main.js';
import {authRoutes,requireAdmin} from './auth.js';
import {routes} from './routes.js';
export async function buildApp(){
 const origin=process.env.APP_ORIGIN||'http://localhost:3000';
 if(process.env.NODE_ENV==='production'&&(!origin.startsWith('https://')||process.env.COOKIE_SECURE!=='true'))throw new Error('Production requires HTTPS APP_ORIGIN and COOKIE_SECURE=true.');
 const app=Fastify({bodyLimit:8*1024*1024,trustProxy:process.env.TRUST_PROXY==='true',logger:{level:'info',redact:['req.headers.cookie','req.headers.authorization','req.body','res.headers.set-cookie']},disableRequestLogging:true});
 const redis=new Redis(process.env.REDIS_URL||'redis://localhost:6379',{
  maxRetriesPerRequest:1,
  connectTimeout:5000,
  retryStrategy:(attempt)=>Math.min(attempt*250,2000)
 });
 const queue=new Queue('sql-arena',{connection:redis});
 await app.register(cookie);await app.register(rateLimit,{max:180,timeWindow:'1 minute',redis,skipOnError:false});
 await app.register(swagger,{openapi:{info:{title:'SQL Arena API',version:'1.0.0'},servers:[{url:origin}]}});
 app.addHook('onRequest',async(req,reply)=>{
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==origin)return reply.code(403).send({error:'Invalid request origin.'});
  reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','strict-origin-when-cross-origin').header('Cache-Control','no-store');
 });
 app.setErrorHandler((error,req,reply)=>{if(error instanceof ZodError)return reply.code(400).send({error:'Invalid request.',details:error.issues.map(i=>({path:i.path.join('.'),message:i.message}))});const e=error as Error&{statusCode?:number,code?:string};if(e.code==='22P02')return reply.code(400).send({error:'Invalid identifier.'});if(e.code==='23505')return reply.code(409).send({error:'This identifier is already in use.'});if(!e.statusCode||e.statusCode>=500)app.log.error({error:e.name,code:e.code,route:req.routeOptions.url},'Request failed');reply.code(e.statusCode||500).send({error:e.statusCode&&e.statusCode<500?e.message:'The service is temporarily unavailable.'});});
 await authRoutes(app);await routes(app,queue);
 await app.register(swaggerUI,{routePrefix:'/api/docs',uiHooks:{onRequest:requireAdmin}});
 app.get('/api/health',async()=>{await db.query('SELECT 1');await redis.ping();return {ok:true};});
 app.addHook('onClose',async()=>{await queue.close();await redis.quit();await db.end();});return app;
}
if(process.env.ARENA_TEST!=='true'){
 const app=await buildApp();
 let stopWorker:(()=>Promise<void>)|undefined;
 if(process.env.PGLITE_PILOT==='true' && process.env.RUN_WORKER_IN_API!=='false'){
  stopWorker=await startWorker();
  app.addHook('onClose',async()=>{await stopWorker?.();});
 }
 await app.listen({host:'0.0.0.0',port:Number(process.env.PORT||4000)});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close());
}
