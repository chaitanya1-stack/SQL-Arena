import {randomUUID} from 'node:crypto';
import {db} from '../apps/api/db.js';
import {passwordHash} from '../apps/api/auth.js';
import {z} from 'zod';
// No default administrator and no publicly usable credentials. JSON is read via
// stdin so credentials are never command arguments or repository files.
let input='';for await(const chunk of process.stdin)input+=chunk;
const v=z.object({email:z.email().transform(s=>s.toLowerCase()),name:z.string().min(2).max(60),password:z.string().min(14).max(128)}).parse(JSON.parse(input));
try{const existing=await db.query('SELECT id FROM users WHERE email=$1',[v.email]);if(existing.rowCount)throw new Error('Account already exists. Refusing to change another account implicitly. Use a new admin email or perform an audited role change directly.');await db.query("INSERT INTO users(id,email,name,password_hash,role,verified) VALUES($1,$2,$3,$4,'admin',true)",[randomUUID(),v.email,v.name,await passwordHash(v.password)]);console.log('Administrator created. Sign in at /?admin=1.');}finally{await db.end();}
