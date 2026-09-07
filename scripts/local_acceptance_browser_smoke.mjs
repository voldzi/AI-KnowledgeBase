#!/usr/bin/env node
// Real local OIDC and central access projection; no token/body logging.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
const results = {};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://localhost:3240', { waitUntil: 'networkidle' });
  if (!(await page.locator('#username').count())) {
    await page.getByRole('button', { name: 'Pokračovat přes STRATOS' }).click();
  }
  await page.locator('#username').waitFor({ timeout: 30_000 });
  await page.locator('#username').fill('operator');
  await page.locator('#password').fill(credentials.operator);
  await page.locator('#kc-login').click();
  await page.waitForURL(url => url.origin === 'http://localhost:3240', { timeout: 30_000 });
  await page.getByRole('heading', { name: 'Přehled správy', exact: true }).waitFor();
  const stratos = await page.request.get('http://localhost:3240/api/v1/auth/me');
  assert.equal(stratos.status(), 200, 'STRATOS browser session must be accepted');
  results.stratos = { authenticated: true, accessCenterVisible: true };
  await page.screenshot({ path: path.join(state, 'stratos-authenticated.png') });

  // A single credential entry above must serve all subsequent application visits.
  // Bootstrap administration does not grant application/data capabilities.
  for (const [name, origin, endpoint] of [
    ['projectflow', 'http://localhost:3231', '/api/auth/session'],
    ['archflow', 'http://localhost:3232', '/api/v1/auth/me'],
  ]) {
    await page.goto(origin, { waitUntil: 'networkidle' });
    const sessionUrl = name === 'archflow' ? 'http://localhost:14001' + endpoint : origin + endpoint;
    await expect.poll(async () => (await page.request.get(sessionUrl)).status(), { timeout: 20_000 }).toBe(200);
    assert.equal(await page.locator('#password').count(), 0, name + ' must not request credentials again');
    results[name] = { authenticated: true, repeatedCredentialEntry: false, applicationDataAcceptance: 'pending_central_test_grants' };
    await page.screenshot({ path: path.join(state, name + '-authenticated.png') });
  }

  for (const [name, origin, base] of [['akb', 'http://localhost:3220', '/akb'], ['chat', 'http://localhost:3221', '']]) {
    await page.goto(origin + base + '/', { waitUntil: 'networkidle' });
    const login = page.getByRole('button', { name: 'Pokračovat k přihlášení' });
    assert.equal(await login.count(), 0, name + ' must complete SSO without another login click');
    assert.equal(await page.locator('#password').count(), 0, name + ' must not request credentials again');
    await page.waitForLoadState('networkidle');
    const session = await page.request.get(origin + base + '/api/auth/session');
    assert.equal(session.status(), 200, name + ' session and central projection must succeed');
    const body = await session.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.user.subjectId, credentials.operator_subject);
    results[name] = { authenticated: true, path: new URL(page.url()).pathname, capabilityCount: body.user.capabilities.length };
    await page.screenshot({ path: path.join(state, name + '-authenticated.png') });
  }
  await page.goto('http://localhost:3240', { waitUntil: 'networkidle' });
  assert.equal((await page.request.get('http://localhost:3240/api/v1/auth/me')).status(), 200);
  assert.equal(await page.locator('#password').count(), 0);
  results.returnToStratos = { authenticated: true, repeatedCredentialEntry: false };
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
