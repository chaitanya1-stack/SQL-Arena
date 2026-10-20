import test from 'node:test';
import assert from 'node:assert/strict';
import {passwordHash,verifyPassword,hash} from '../apps/api/auth.js';
test('password hashes use independent salts and verify exactly',async()=>{const a=await passwordHash('long-random-test-password'),b=await passwordHash('long-random-test-password');assert.notEqual(a,b);assert.ok(await verifyPassword('long-random-test-password',a));assert.equal(await verifyPassword('incorrect-password',a),false);});
test('session tokens are fingerprinted deterministically',()=>{assert.equal(hash('random-token').length,64);assert.equal(hash('a'),hash('a'));assert.notEqual(hash('a'),hash('b'));});
