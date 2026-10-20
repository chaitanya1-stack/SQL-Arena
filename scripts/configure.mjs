import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
if(existsSync('.env')){console.log('.env already exists; left unchanged.');process.exit(0);}
const password=randomBytes(32).toString('hex');
const text=readFileSync('.env.example','utf8').replace('POSTGRES_PASSWORD=','POSTGRES_PASSWORD='+password).replace('arena:change-me@','arena:'+password+'@');
writeFileSync('.env',text,{mode:0o600});console.log('Created local configuration with a generated database password.');
