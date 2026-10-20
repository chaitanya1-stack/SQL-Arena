import {readFile} from 'node:fs/promises';
import {db,transaction} from '../apps/api/db.js';
try{await transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(723912)');await c.query(await readFile(new URL('../db/001.sql',import.meta.url),'utf8'));});console.log('Database schema ready.');}finally{await db.end();}
