import {randomBytes,randomUUID,createHash,scrypt as rawScrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import nodemailer from 'nodemailer';
import {z} from 'zod';
import {db,audit,transaction} from './db.js';
const scrypt=promisify(rawScrypt);
export type User={id:string,email:string|null,name:string,role:'user'|'admin'|'guest',verified:boolean};
declare module 'fastify'{interface FastifyRequest{user:User|null;}}
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function passwordHash(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64) as Buffer).toString('hex');}
export async function verifyPassword(password:string,value:string){const [salt,h]=value.split(':');const actual=await scrypt(password,salt,64) as Buffer,expected=Buffer.from(h,'hex');return expected.length===actual.length&&timingSafeEqual(expected,actual);}
const cookieOptions={path:'/',httpOnly:true,secure:process.env.COOKIE_SECURE==='true',sameSite:'lax' as const};
export async function session(reply:FastifyReply,userId:string){const token=randomBytes(32).toString('hex');await db.query('INSERT INTO sessions VALUES($1,$2,now()+interval \'14 days\')',[hash(token),userId]);reply.setCookie('arena_session',token,{...cookieOptions,maxAge:14*86400});}
export async function requireUser(req:FastifyRequest,reply:FastifyReply){if(!req.user)return reply.code(401).send({error:'Sign in or continue as a guest.'});}
export async function requireAdmin(req:FastifyRequest,reply:FastifyReply){if(req.user?.role!=='admin')return reply.code(403).send({error:'Administrator access required.'});}
const credentials=z.object({email:z.email().transform(s=>s.toLowerCase().trim()),password:z.string().min(10).max(128),name:z.string().trim().min(2).max(60).optional()});
const limited={config:{rateLimit:{max:6,timeWindow:'1 minute'}}};
async function mailToken(user:User,kind:'reset'|'verify'){
  if(!process.env.SMTP_URL||!process.env.MAIL_FROM)throw Object.assign(new Error('Email service is not configured.'),{statusCode:503});
  const token=randomBytes(32).toString('hex');await db.query('INSERT INTO auth_tokens VALUES($1,$2,$3,now()+interval \'30 minutes\')',[hash(token),user.id,kind]);
  const url=`${process.env.PUBLIC_ORIGIN}/?auth=${kind}&token=${token}`;
  await nodemailer.createTransport(process.env.SMTP_URL).sendMail({from:process.env.MAIL_FROM,to:user.email!,subject:kind==='reset'?'Reset your SQL Arena password':'Verify your SQL Arena email',text:`Open this link within 30 minutes: ${url}\nIf you did not request this, ignore this email.`});
}
export async function authRoutes(app:FastifyInstance){
  app.decorateRequest('user',null);
  app.addHook('onRequest',async req=>{const token=req.cookies.arena_session;if(token){const r=await db.query('SELECT u.id,u.email,u.name,u.role,u.verified FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',[hash(token)]);req.user=r.rows[0]||null;}});
  app.get('/api/me',async req=>({user:req.user,googleEnabled:!!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),emailEnabled:!!(process.env.SMTP_URL&&process.env.MAIL_FROM)}));
  app.post('/api/auth/register',limited,async(req,reply)=>{const v=credentials.parse(req.body),id=randomUUID();try{await db.query('INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,$3,$4)',[id,v.email,await passwordHash(v.password),v.name||v.email.split('@')[0]]);}catch(e){if((e as {code:string}).code==='23505')return reply.code(409).send({error:'Unable to register this email.'});throw e;}await session(reply,id);return {ok:true};});
  app.post('/api/auth/login',limited,async(req,reply)=>{const v=credentials.parse(req.body);const {rows}=await db.query('SELECT * FROM users WHERE email=$1',[v.email]);const u=rows[0];const dummy='0123456789abcdef0123456789abcdef:'+('00'.repeat(64));const valid=await verifyPassword(v.password,u?.password_hash||dummy);if(!u||!valid)return reply.code(401).send({error:'Incorrect email or password.'});if(req.cookies.arena_session)await db.query('DELETE FROM sessions WHERE token_hash=$1',[hash(req.cookies.arena_session)]);await session(reply,u.id);return {ok:true};});
  app.post('/api/auth/guest',limited,async(req,reply)=>{if(req.user)return {ok:true};const id=randomUUID();await db.query("INSERT INTO users(id,name,role) VALUES($1,'Guest learner','guest')",[id]);await session(reply,id);return {ok:true};});
  app.post('/api/auth/logout',async(req,reply)=>{if(req.cookies.arena_session)await db.query('DELETE FROM sessions WHERE token_hash=$1',[hash(req.cookies.arena_session)]);reply.clearCookie('arena_session',cookieOptions);return {ok:true};});
  app.post('/api/auth/forgot',limited,async(req)=>{const {email}=z.object({email:z.email().transform(s=>s.toLowerCase())}).parse(req.body);if(!process.env.SMTP_URL)throw Object.assign(new Error('Email service is not configured.'),{statusCode:503});const {rows}=await db.query('SELECT * FROM users WHERE email=$1',[email]);if(rows[0])await mailToken(rows[0],'reset');return {message:'If an account exists, a reset link has been sent.'};});
  app.post('/api/auth/request-verification',{...limited,preHandler:requireUser},async req=>{if(!req.user!.email)throw Object.assign(new Error('Guests do not have an email address.'),{statusCode:400});await mailToken(req.user!,'verify');return {ok:true};});
  app.post('/api/auth/token',limited,async(req,reply)=>{const v=z.object({token:z.string().length(64),password:z.string().min(10).max(128).optional()}).parse(req.body);await transaction(async c=>{const {rows}=await c.query('SELECT * FROM auth_tokens WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',[hash(v.token)]);const t=rows[0];if(!t)throw Object.assign(new Error('This link is invalid or expired.'),{statusCode:400});if(t.kind==='reset'){if(!v.password)throw Object.assign(new Error('Enter a new password.'),{statusCode:400});await c.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await passwordHash(v.password),t.user_id]);await c.query('DELETE FROM sessions WHERE user_id=$1',[t.user_id]);}else await c.query('UPDATE users SET verified=true WHERE id=$1',[t.user_id]);await c.query('DELETE FROM auth_tokens WHERE user_id=$1 AND kind=$2',[t.user_id,t.kind]);});reply.clearCookie('arena_session',cookieOptions);return {ok:true};});
  app.patch('/api/profile',{preHandler:requireUser},async req=>{const v=z.object({name:z.string().trim().min(2).max(60)}).parse(req.body);await db.query('UPDATE users SET name=$1 WHERE id=$2',[v.name,req.user!.id]);return {ok:true};});
  app.delete('/api/account',{preHandler:requireUser},async(req,reply)=>{const v=z.object({confirmation:z.literal('DELETE'),password:z.string().optional()}).parse(req.body);const {rows}=await db.query('SELECT password_hash FROM users WHERE id=$1',[req.user!.id]);if(rows[0].password_hash&&(!v.password||!await verifyPassword(v.password,rows[0].password_hash)))return reply.code(401).send({error:'Enter your password to delete this account.'});await db.query('DELETE FROM users WHERE id=$1',[req.user!.id]);reply.clearCookie('arena_session',cookieOptions);return {ok:true};});
  app.get('/api/auth/google',limited,async(req,reply)=>{
    if(!process.env.GOOGLE_CLIENT_ID)return reply.code(503).send({error:'Google sign-in is not configured.'});
    const state=randomBytes(32).toString('hex'),verifier=randomBytes(48).toString('base64url');
    reply.setCookie('oauth_state',state,{...cookieOptions,maxAge:600});reply.setCookie('oauth_verifier',verifier,{...cookieOptions,maxAge:600});
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:`${process.env.PUBLIC_ORIGIN}/api/auth/google/callback`,response_type:'code',scope:'openid email profile',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();return reply.redirect(url.toString());
  });
  app.get('/api/auth/google/callback',limited,async(req,reply)=>{
    const q=z.object({code:z.string(),state:z.string()}).parse(req.query);
    if(!req.cookies.oauth_state||q.state!==req.cookies.oauth_state||!req.cookies.oauth_verifier)return reply.code(400).send({error:'Invalid OAuth state.'});
    reply.clearCookie('oauth_state',cookieOptions);reply.clearCookie('oauth_verifier',cookieOptions);
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:q.code,client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,redirect_uri:`${process.env.PUBLIC_ORIGIN}/api/auth/google/callback`,grant_type:'authorization_code',code_verifier:req.cookies.oauth_verifier}),signal:AbortSignal.timeout(10000)});
    const token=await response.json() as {access_token?:string};if(!response.ok||!token.access_token)throw Object.assign(new Error('Google sign-in failed.'),{statusCode:400});
    const profileResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(10000)});const p=z.object({sub:z.string(),email:z.email(),email_verified:z.literal(true),name:z.string().optional()}).parse(await profileResponse.json());
    const {rows}=await db.query('SELECT id FROM users WHERE google_id=$1',[p.sub]);let id=rows[0]?.id;
    if(!id){const existing=await db.query('SELECT id FROM users WHERE email=$1',[p.email.toLowerCase()]);if(existing.rowCount)return reply.code(409).send({error:'This email already has an account. Sign in with its password.'});id=randomUUID();await db.query('INSERT INTO users(id,email,name,google_id,verified) VALUES($1,$2,$3,$4,true)',[id,p.email.toLowerCase(),p.name||p.email.split('@')[0],p.sub]);}
    await session(reply,id);await audit(id,'oauth.login');return reply.redirect('/');
  });
}
