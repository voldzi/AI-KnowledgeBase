#!/usr/bin/env node
// Real local OIDC and central access projection; no token/body logging.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root=process.cwd();
const state = path.join(root, 'data/local-acceptance');
const require = createRequire(path.join(root, 'apps/web/package.json'));
const { chromium, expect } = require('@playwright/test');
const credentials = JSON.parse(fs.readFileSync(path.join(state, 'credentials.json'), 'utf8'));
const publicKey = execFileSync('openssl', ['x509', '-in', path.join(state, 'tls/server.pem'), '-pubkey', '-noout']);
const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'DER'], { input: publicKey });
const pin = createHash('sha256').update(der).digest('base64');
const browser = await chromium.launch({ headless: true, args: [
  '--host-resolver-rules=MAP login.akb.localhost 127.0.0.1',
  '--ignore-certificate-errors-spki-list=' + pin,
] });

const users=JSON.parse(fs.readFileSync(path.join(state,'suite-users.json'),'utf8'));
async function login(username,password,contextOptions={}){
 const context=await browser.newContext({viewport:{width:1440,height:1000},...contextOptions});const page=await context.newPage();page.on('response',async r=>{if(new URL(r.url()).pathname.endsWith('/oidc/token')&&!r.ok()){let e=await r.json();console.log(JSON.stringify({phase:'login_error',username,status:r.status(),code:e.code,message:e.message}));}});
 await page.goto('http://localhost:3240',{waitUntil:'networkidle'});
 if(!(await page.locator('#username').count())) await page.getByRole('button',{name:'Pokračovat přes STRATOS'}).click();
 await page.locator('#username').waitFor({timeout:30000});await page.locator('#username').fill(username);await page.locator('#password').fill(password);await page.locator('#kc-login').click();
 await page.waitForURL(u=>u.origin==='http://localhost:3240',{timeout:30000});
 await expect.poll(async()=> (await page.request.get('http://localhost:3240/api/v1/auth/me')).status(),{timeout:20000}).toBe(200);
 await page.waitForLoadState('networkidle');return page;
}

const targets={stratos:['http://localhost:3240','Budget & Contract','http://localhost:3240/api/v1/auth/me'],projectflow:['http://localhost:3231','ProjectFlow','http://localhost:3231/api/auth/session'],archflow:['http://localhost:3232','ArchFlow','http://localhost:14001/api/v1/auth/me'],akb:['http://localhost:3220/akb','AI KnowledgeBase','http://localhost:3220/akb/api/auth/session'],chat:['http://localhost:3221','Chat','http://localhost:3221/api/auth/session']};
const results={};let admin,reader,member;
const status=async(p,url)=>(await p.request.get(url,{headers:{'X-STRATOS-Session-Probe':'1'}})).status();
async function patch(data){const r=await admin.request.patch('http://localhost:3240/api/v1/access/members/'+member.membershipId,{headers:{Origin:'http://localhost:3240'},data:{reason:'AKB suite 0.5.1 local acceptance; synthetic reader only',...data}});assert.equal(r.status(),200);}
async function check(name,fn){console.log(JSON.stringify({phase:name,status:'RUNNING'}));try{results[name]={status:'PASS',...await fn()};}catch(e){results[name]={status:'FAIL',reason:e.name,detail:e.message.split('\n').slice(0,5).join(' ').slice(0,250)};}fs.writeFileSync(path.join(state,'suite-051-lifecycle-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({phase:name,...results[name]}));}
const pages={};
try{
 reader=await login(users.reader.username,users.reader.password);
 admin=await login('operator',credentials.operator);
 const members=await (await admin.request.get('http://localhost:3240/api/v1/access/tenants/org_stratos/members')).json();member=members.find(m=>m.user.identitySubject===users.reader.subject);assert.ok(member&&member.isActive!==false);
 await check('five_parallel_authenticated_tabs',async()=>{for(const[name,[url,label,api]]of Object.entries(targets)){const p=await reader.context().newPage();pages[name]=p;await p.goto(url,{waitUntil:'networkidle'});await p.getByRole('button',{name:label,exact:true}).first().waitFor({timeout:30000});assert.equal(await status(p,api),200);assert.equal(await p.locator('#password').count(),0);}const cookies=await reader.context().cookies();for(const name of ['akb_platform_session','akb_chat_session'])assert.equal(cookies.filter(c=>c.name===name).length,1);return {credentialEntries:1,cookieNamespacesDistinct:true};});
 await check('projectflow_real_grant_revocation_ui',async()=>{const p=pages.projectflow;await p.bringToFront();await p.locator('.workspace-header').first().waitFor();const start=Date.now();try{await patch({applicationAccesses:[{application:'PROJECTFLOW',isActive:false}]});await p.locator('.workspace-header').first().waitFor({state:'hidden',timeout:75000});assert.equal(await status(p,'http://localhost:3231/api/bootstrap'),403);return {elapsedMs:Date.now()-start};}finally{await patch({applicationAccesses:[{application:'PROJECTFLOW',isActive:true}]});await expect.poll(()=>status(p,'http://localhost:3231/api/bootstrap'),{timeout:45000}).toBe(200);await p.reload({waitUntil:'networkidle'});}});
 // Fault injection must bypass the PWA worker; real navigation/logout keep it enabled.
 const actualPages={...pages};const faults=await login(users.reader.username,users.reader.password,{serviceWorkers:'block'});
 try {for(const name of ['akb','chat']){pages[name]=await faults.context().newPage();await pages[name].goto(targets[name][0],{waitUntil:'networkidle'});}
 for(const name of ['akb','chat'])for(const code of [401,403,503])await check(name+'_probe_'+code+'_ui',async()=>{const p=pages[name];await p.bringToFront();await p.reload({waitUntil:'networkidle'});await p.getByRole('button',{name:targets[name][1],exact:true}).first().waitFor();const route=async r=>{if(r.request().headers()['x-stratos-session-probe']==='1')await r.fulfill({status:code,contentType:'application/json',body:JSON.stringify({authenticated:false})});else await r.continue();};await p.route(targets[name][2],route);const start=Date.now();try{await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.getByTestId('session-authority-guard').waitFor({timeout:15000});assert.equal(await p.locator('.akb-employee-portal-shell').count(),0);return {elapsedMs:Date.now()-start,evidence:'controlled transport fault, not central revocation'};}finally{await p.unroute(targets[name][2],route);await p.reload({waitUntil:'networkidle'});}});
 } finally {await faults.context().close();Object.assign(pages,actualPages);}
 await check('central_membership_revocation_akb_chat_ui',async()=>{for(const name of ['akb','chat']){await pages[name].reload({waitUntil:'networkidle'});await pages[name].getByRole('button',{name:targets[name][1],exact:true}).first().waitFor();}const start=Date.now();try{await patch({isActive:false});const timings={};for(const name of ['akb','chat']){await pages[name].bringToFront();await pages[name].evaluate(()=>window.dispatchEvent(new Event('focus')));await pages[name].getByTestId('session-authority-guard').waitFor({timeout:75000});timings[name]=Date.now()-start;assert.equal(await pages[name].locator('.akb-employee-portal-shell').count(),0);}return {elapsedMs:timings};}finally{await patch({isActive:true});}});
 // A clean browser context avoids retaining the deliberately denied UI from the preceding test.
 await reader.context().close();reader=await login(users.reader.username,users.reader.password);
 for(const[name,[url,label,api]]of Object.entries(targets)){const p=await reader.context().newPage();pages[name]=p;await p.goto(url,{waitUntil:'networkidle'});await p.getByRole('button',{name:label,exact:true}).first().waitFor({timeout:30000});assert.equal(await status(p,api),200);}
 await check('central_logout_all_bff_standard_policy',async()=>{const p=pages.chat;await p.bringToFront();await p.getByRole('button',{name:'Uživatelské menu'}).click();await p.getByRole('menuitem',{name:'Odhlásit',exact:true}).click();await p.waitForLoadState('networkidle');const confirm=p.locator('#kc-logout');if(await confirm.count()){await confirm.click();await p.waitForLoadState('networkidle');}const start=Date.now();const denied={},ui={};for(const name of ['akb','projectflow','archflow','stratos'])await pages[name].bringToFront();await expect.poll(async()=>{for(const[name,[url,label,api]]of Object.entries(targets)){if(!denied[name]&&(await status(pages[name],api))===401)denied[name]=Date.now()-start;const guard=pages[name].getByTestId('session-authority-guard');if(!ui[name]&&await guard.count())ui[name]=Date.now()-start;}console.log(JSON.stringify({phase:'logout_observation',elapsedMs:Date.now()-start,denied,ui}));return Object.keys(denied).length;},{timeout:1020000,intervals:[15000]}).toBe(5);for(const name of ['akb','chat']){await pages[name].bringToFront();await pages[name].evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(async()=> await pages[name].getByTestId('session-authority-guard').count()||await pages[name].getByRole('button',{name:'Pokračovat k přihlášení'}).count(),{timeout:15000}).toBeGreaterThan(0);ui[name]??=Date.now()-start;}return {standardIdentityFreshness:true,denialAfterMs:denied,uiHiddenAfterMs:ui};});
}finally{await browser.close();}
if(Object.values(results).some(r=>r.status==='FAIL'))process.exitCode=1;
