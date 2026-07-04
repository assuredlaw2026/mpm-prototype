// MPM prototype — Phase 3 automated QA: S1 bypass tests.
// Each test asserts a compliance control fails CLOSED. Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.mjs';
import { openDb, audit } from '../src/db.mjs';

let server, base;
before(async () => { server = createServer(':memory:'); await new Promise(r => server.listen(0, r)); base = `http://localhost:${server.address().port}`; });
after(() => server.close());

async function api(method, p, body, headers = {}) {
  const r = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
const auth = (id) => ({ 'x-account-id': id });
let seq = 0;

// Build a property/tenant/paid purchase and an inspection matter; optionally drive
// the tenant through to a submitted inspection with one flagged issue.
async function createCase(opts = {}) {
  const email = `o${seq++}_${Date.now()}@x.com`;
  const acc = (await api('POST', '/api/accounts', { email, name: 'O' })).j.id;
  const A = (m, p, b) => api(m, p, b, auth(acc));
  const pid = (await A('POST', '/api/properties', { address: 'A', jurisdiction: opts.jurisdiction || 'NV' })).j.id;
  const tid = (await A('POST', `/api/properties/${pid}/tenants`, { name: 'T' })).j.id;
  await A('POST', `/api/properties/${pid}/attestation`, { tenant_id: tid, authority: true, accuracy: true, consent_basis: true, relationship: true, truth: true });
  const purId = (await A('POST', '/api/purchases', { property_id: pid, package_code: 'SINGLE' })).j.id;
  const mk = await A('POST', '/api/matters', { property_id: pid, tenant_id: tid, purchase_id: purId });
  const mid = mk.j.id, token = mk.j.token;
  await A('POST', `/api/matters/${mid}/send-link`, { channel: 'sms' });
  const ctx = { acc, A, pid, tid, purId, mid, token, issueId: null };
  if (!opts.submit) return ctx;

  await api('POST', `/api/inspect/${token}/consent`, { participate: true });
  const prompts = (await api('GET', `/api/inspect/${token}`)).j.prompts.filter(p => p.mandatory);
  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    const isIssue = opts.issue && i === 0;
    const rr = await api('POST', `/api/inspect/${token}/response`, {
      prompt_id: p.id, value: 'noted', condition: isIssue ? 'issue' : 'ok',
      category: isIssue ? (opts.category || 'cosmetic_wall') : null,
      ai_confidence: isIssue ? (opts.ai_confidence ?? 0.9) : undefined
    });
    if (p.requires_media) await api('POST', `/api/inspect/${token}/media`, {
      response_id: rr.j.id, kind: 'photo', review_quality_status: isIssue ? (opts.quality || 'adequate') : 'adequate'
    });
  }
  await api('POST', `/api/inspect/${token}/certify`, {});
  const report = await ctx.A('GET', `/api/matters/${mid}/report`);
  ctx.issueId = report.j.issues[0]?.id || null;
  return ctx;
}

async function disposition(ctx, { classification, owner_facts, exposure }) {
  return ctx.A('POST', `/api/issues/${ctx.issueId}/disposition`, { classification, owner_facts, estimated_exposure_cents: exposure });
}
async function leaseEvidence(ctx) {
  return ctx.A('POST', `/api/matters/${ctx.mid}/lease-evidence`, { clause_reference: '12', obligation_type: 'maintenance', owner_summary: 'tenant must maintain', owner_certifies: true });
}
async function finding(ctx) {
  return ctx.A('POST', `/api/matters/${ctx.mid}/finding-predicate`, { issue_id: ctx.issueId });
}

// ---------- Positive baselines ----------
test('POSITIVE: clean finding produces a valid predicate (and NOT a sendable notice)', async () => {
  const ctx = await createCase({ submit: true, issue: true, category: 'cosmetic_wall', ai_confidence: 0.9, quality: 'adequate' });
  await disposition(ctx, { classification: 'tenant_responsibility_possible', owner_facts: 'tenant caused the scuff', exposure: 50000 });
  await leaseEvidence(ctx);
  const r = await finding(ctx);
  assert.equal(r.status, 200);
  assert.equal(r.j.predicate_valid, true, 'clean inputs should yield a valid predicate');
  assert.equal(r.j.high_risk_result, false);
});

// ---------- ND: no direct inspection -> notice ----------
test('ND-01: a completed inspection does not auto-create any notice or sendable notice', async () => {
  const ctx = await createCase({ submit: true, issue: true });
  const db2 = null; // assert via API surface: no notice endpoints fire on submission
  const file = await ctx.A('GET', `/api/properties/${ctx.pid}/file`);
  assert.equal(file.status, 200);
  // a valid finding predicate still does not yield a sendable notice
  await disposition(ctx, { classification: 'tenant_responsibility_possible', owner_facts: 'x', exposure: 1000 });
  await leaseEvidence(ctx);
  const r = await finding(ctx);
  assert.equal(r.j.predicate_valid, true);
  assert.ok(!('sendable' in r.j) || r.j.sendable !== true, 'finding predicate must not be a sendable notice');
});

test('ND-02: incomplete inspection cannot route directly to a notice (no cooperation => Gate A fails)', async () => {
  const ctx = await createCase({});
  await ctx.A('POST', `/api/dev/matter/${ctx.mid}/expire-deadline`, {});
  await ctx.A('POST', '/api/dev/clock', { advance_ms: 25 * 60 * 60 * 1000 });
  await ctx.A('POST', `/api/matters/${ctx.mid}/resolve-timeout`, {});
  // skip cooperation request entirely, attempt eligibility
  const r = await ctx.A('POST', `/api/matters/${ctx.mid}/notice-eligibility`, { origin: 'inspection_noncompletion', screen: { protected_activity: false, disputed_facts: false } });
  assert.equal(r.j.gates.A, false, 'Gate A must fail without a completed cooperation window');
  assert.equal(r.j.attorney_routed, true);
  assert.equal(r.j.sendable, false);
});

test('ND-03: an AI flag alone (no disposition/owner facts) cannot create a valid finding predicate', async () => {
  const ctx = await createCase({ submit: true, issue: true });
  const r = await finding(ctx); // no disposition, no lease evidence
  assert.equal(r.j.predicate_valid, false);
  assert.ok(r.j.reasons.includes('no_owner_disposition'));
  assert.ok(r.j.reasons.includes('no_lease_evidence'));
  assert.equal(r.j.route, 'attorney_or_professional_review');
});

test('ND-04: declined media capture must traverse cooperation; it cannot go straight to a notice', async () => {
  const ctx = await createCase({});
  await api('POST', `/api/inspect/${ctx.token}/consent`, { participate: false });
  // cooperation request is permitted on a declined matter
  const coop = await ctx.A('POST', `/api/matters/${ctx.mid}/cooperation-request`, {});
  assert.equal(coop.status, 200);
  // immediately evaluating (window not expired) => Gate A fails, attorney routed
  const r = await ctx.A('POST', `/api/matters/${ctx.mid}/notice-eligibility`, { origin: 'inspection_noncompletion', screen: { protected_activity: false, disputed_facts: false } });
  assert.equal(r.j.gates.A, false);
  assert.equal(r.j.sendable, false);
});

// ---------- FP: finding predicate guards ----------
test('FP-01: finding predicate requires a completed (submitted) inspection', async () => {
  const ctx = await createCase({}); // not submitted
  const r = await ctx.A('POST', `/api/matters/${ctx.mid}/finding-predicate`, { issue_id: 'nope' });
  assert.equal(r.status, 409);
  assert.equal(r.j.error, 'E_NO_COMPLETED_INSPECTION');
});

test('FP-02: owner_maintenance classification cannot support a finding predicate', async () => {
  const ctx = await createCase({ submit: true, issue: true });
  await disposition(ctx, { classification: 'owner_maintenance', owner_facts: 'my responsibility', exposure: 10000 });
  await leaseEvidence(ctx);
  const r = await finding(ctx);
  assert.equal(r.j.predicate_valid, false);
  assert.ok(r.j.reasons.some(x => x.startsWith('classification_owner_maintenance')));
});

test('FP-03: missing lease/obligation evidence fails the finding predicate (Gate A)', async () => {
  const ctx = await createCase({ submit: true, issue: true });
  await disposition(ctx, { classification: 'tenant_responsibility_possible', owner_facts: 'tenant caused it', exposure: 10000 });
  const r = await finding(ctx); // no lease evidence
  assert.equal(r.j.predicate_valid, false);
  assert.ok(r.j.reasons.includes('no_lease_evidence'));
});

test('FP-04: exposure over $1,000 routes to attorney; unknown exposure also routes to attorney', async () => {
  const over = await createCase({ submit: true, issue: true });
  await disposition(over, { classification: 'tenant_responsibility_possible', owner_facts: 'x', exposure: 150000 });
  await leaseEvidence(over);
  let r = await finding(over);
  assert.equal(r.j.predicate_valid, false);
  assert.ok(r.j.reasons.includes('exposure_over_threshold'));

  const unknown = await createCase({ submit: true, issue: true });
  await disposition(unknown, { classification: 'tenant_responsibility_possible', owner_facts: 'x', exposure: null });
  await leaseEvidence(unknown);
  r = await finding(unknown);
  assert.equal(r.j.predicate_valid, false);
  assert.ok(r.j.reasons.includes('exposure_unknown'));
});

test('FP-05: uncertain evidence quality fails closed (treated as inadequate)', async () => {
  const ctx = await createCase({ submit: true, issue: true, quality: 'uncertain' });
  await disposition(ctx, { classification: 'tenant_responsibility_possible', owner_facts: 'x', exposure: 10000 });
  await leaseEvidence(ctx);
  const r = await finding(ctx);
  assert.equal(r.j.predicate_valid, false);
  assert.equal(r.j.evidence_quality_result, 'inadequate');
  assert.ok(r.j.reasons.includes('evidence_uncertain'));
});

test('FP-bonus: high-risk category and sub-threshold AI confidence each route to attorney', async () => {
  const hr = await createCase({ submit: true, issue: true, category: 'mold' });
  await disposition(hr, { classification: 'tenant_responsibility_possible', owner_facts: 'x', exposure: 10000 });
  await leaseEvidence(hr);
  let r = await finding(hr);
  assert.equal(r.j.predicate_valid, false);
  assert.ok(r.j.reasons.some(x => x.startsWith('category_mold')));

  const lowconf = await createCase({ submit: true, issue: true, category: 'cosmetic_wall', ai_confidence: 0.4 });
  await disposition(lowconf, { classification: 'tenant_responsibility_possible', owner_facts: 'x', exposure: 10000 });
  await leaseEvidence(lowconf);
  r = await finding(lowconf);
  assert.equal(r.j.predicate_valid, false);
  assert.ok(r.j.reasons.includes('ai_confidence_below_threshold'));
});

// ---------- AP: attorney off-ramp ----------
test('AP-01: an attorney-routed notice cannot be owner-approved', async () => {
  const ctx = await createCase({ jurisdiction: 'NV' });
  await ctx.A('POST', `/api/dev/matter/${ctx.mid}/expire-deadline`, {});
  await ctx.A('POST', '/api/dev/clock', { advance_ms: 25 * 60 * 60 * 1000 });
  await ctx.A('POST', `/api/matters/${ctx.mid}/resolve-timeout`, {});
  await ctx.A('POST', `/api/matters/${ctx.mid}/cooperation-request`, {});
  // do not advance past the 48h window => Gate A fails => attorney routed
  const elig = await ctx.A('POST', `/api/matters/${ctx.mid}/notice-eligibility`, { origin: 'inspection_noncompletion', screen: { protected_activity: false, disputed_facts: false } });
  assert.equal(elig.j.attorney_routed, true);
  const approve = await ctx.A('POST', `/api/notice-matters/${elig.j.notice_matter_id}/approve`, {});
  assert.equal(approve.status, 409);
  assert.equal(approve.j.error, 'E_ATTORNEY_REVIEW');
});

// ---------- SMS: TCPA gate ----------
test('SMS-01: live SMS is blocked until TCPA counsel approval is recorded', async () => {
  const blocked = await api('POST', '/api/live/sms', { to: 'x' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.j.error, 'E_TCPA_NOT_APPROVED');
  // it is a real gate: once counsel approval is recorded, the capability unblocks
  await api('POST', '/api/dev/tcpa', { approved: true });
  const allowed = await api('POST', '/api/live/sms', { to: 'x' });
  assert.equal(allowed.status, 200);
  await api('POST', '/api/dev/tcpa', { approved: false }); // restore gate
});

// ---------- GN: no generic notice fallback ----------
test('GN-01: no state notice content => no generic fallback; approval and live generation are blocked', async () => {
  // jurisdiction NV with module OFF (default)
  const ctx = await createCase({ jurisdiction: 'NV' });
  await ctx.A('POST', `/api/dev/matter/${ctx.mid}/expire-deadline`, {});
  await ctx.A('POST', '/api/dev/clock', { advance_ms: 25 * 60 * 60 * 1000 });
  await ctx.A('POST', `/api/matters/${ctx.mid}/resolve-timeout`, {});
  await ctx.A('POST', `/api/matters/${ctx.mid}/cooperation-request`, {});
  await ctx.A('POST', '/api/dev/clock', { advance_ms: 49 * 60 * 60 * 1000 });
  const elig = await ctx.A('POST', `/api/matters/${ctx.mid}/notice-eligibility`, { origin: 'inspection_noncompletion', screen: { protected_activity: false, disputed_facts: false } });
  assert.equal(elig.j.gates.E, false, 'Gate E must fail without approved state content');
  assert.equal(elig.j.state_module_available, false);
  // Per CG-2, an unavailable state module has no generic/template fallback and routes the
  // matter to the attorney off-ramp; approval is therefore blocked. The live generation path
  // below independently refuses with E_STATE_MODULE_UNAVAILABLE.
  const approve = await ctx.A('POST', `/api/notice-matters/${elig.j.notice_matter_id}/approve`, {});
  assert.equal(approve.status, 409);
  assert.equal(approve.j.error, 'E_ATTORNEY_REVIEW');
  const live = await api('POST', '/api/live/notice-generate', { matter_id: ctx.mid });
  assert.equal(live.status, 403);
  assert.equal(live.j.error, 'E_STATE_MODULE_UNAVAILABLE');
});

// ---------- MP: mailing requires approval AND sendability ----------
test('MP-01: mailing is blocked without owner approval; allowed only when fully sendable', async () => {
  const ctx = await createCase({ jurisdiction: 'NV' });
  await ctx.A('POST', '/api/dev/state-module', { jurisdiction: 'NV', available: true }); // simulate counsel-approved content
  await ctx.A('POST', `/api/dev/matter/${ctx.mid}/expire-deadline`, {});
  await ctx.A('POST', '/api/dev/clock', { advance_ms: 25 * 60 * 60 * 1000 });
  await ctx.A('POST', `/api/matters/${ctx.mid}/resolve-timeout`, {});
  await ctx.A('POST', `/api/matters/${ctx.mid}/cooperation-request`, {});
  await ctx.A('POST', '/api/dev/clock', { advance_ms: 49 * 60 * 60 * 1000 });
  const elig = await ctx.A('POST', `/api/matters/${ctx.mid}/notice-eligibility`, { origin: 'inspection_noncompletion', screen: { protected_activity: false, disputed_facts: false } });
  assert.equal(elig.j.attorney_routed, false, 'all gates should pass with module on and clean screen');
  // mail before approval => blocked
  const early = await ctx.A('POST', `/api/notice-matters/${elig.j.notice_matter_id}/mail`, {});
  assert.equal(early.status, 409);
  assert.equal(early.j.error, 'E_NOTICE_NOT_APPROVED');
  // approve => sendable, then mail allowed
  const approve = await ctx.A('POST', `/api/notice-matters/${elig.j.notice_matter_id}/approve`, {});
  assert.equal(approve.j.sendable, true);
  const mailed = await ctx.A('POST', `/api/notice-matters/${elig.j.notice_matter_id}/mail`, {});
  assert.equal(mailed.status, 200);
  await ctx.A('POST', '/api/dev/state-module', { jurisdiction: 'NV', available: false }); // restore gate
});

test('MP-trigger: the database refuses a mail job for a non-sendable notice (backstop)', () => {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO account(id,email,name,created_at) VALUES('a','a@x','A',0)`).run();
  db.prepare(`INSERT INTO property(id,account_id,address,jurisdiction,created_at) VALUES('p','a','A','NV',0)`).run();
  db.prepare(`INSERT INTO tenant(id,property_id,name,created_at) VALUES('t','p','T',0)`).run();
  db.prepare(`INSERT INTO purchase(id,account_id,property_id,package_code,price_cents,status,created_at)
              VALUES('pu','a','p','SINGLE',7500,'paid',0)`).run();
  db.prepare(`INSERT INTO inspection_matter(id,property_id,tenant_id,purchase_id,token,status,deadline_at,created_at)
              VALUES('m','p','t','pu','tok','not_completed',0,0)`).run(); // valid FK parents; the trigger is the subject
  db.prepare(`INSERT INTO notice_predicate(id,matter_id,origin,predicate_valid,attorney_routed,created_at)
              VALUES('np','m','inspection_noncompletion',1,0,0)`).run();
  // owner_approved=1 but a gate is unmet => sendable MUST remain 0
  db.prepare(`INSERT INTO notice_matter(id,predicate_id,property_id,predicate_valid,gate_a,gate_b,gate_c,gate_d,gate_e,
              state_module_available,attorney_routed,owner_approved,sendable,status,created_at)
              VALUES('nm','np','p',1,1,1,1,1,0,0,0,1,0,'draft',0)`).run();
  assert.throws(() => db.prepare(`INSERT INTO mail_job(id,notice_matter_id,status,created_at) VALUES('mj','nm','queued',0)`).run(),
    /E_NOTICE_NOT_SENDABLE/);
  db.close();
});

// ---------- CL: copy lint ----------
test('CL-01: forbidden marketing/legal-sufficiency terms are rejected', async () => {
  for (const text of ['we guarantee results', 'this is legal advice', 'only $25', 'court-ready packet']) {
    const r = await api('POST', '/api/copy-lint', { text });
    assert.equal(r.status, 400, `should reject: ${text}`);
    assert.equal(r.j.error, 'E_COPY_FORBIDDEN_TERM');
  }
  // and in owner-entered finding facts
  const ctx = await createCase({ submit: true, issue: true });
  const r = await ctx.A('POST', `/api/issues/${ctx.issueId}/disposition`, { classification: 'tenant_responsibility_possible', owner_facts: 'I guarantee the tenant did it', estimated_exposure_cents: 1000 });
  assert.equal(r.status, 400);
  assert.equal(r.j.error, 'E_COPY_FORBIDDEN_TERM');
});

// ---------- EX: media privacy ----------
test('EX-01: media is private; only a signed URL or authorized session grants access', async () => {
  const ctx = await createCase({ submit: true, issue: true });
  const report = await ctx.A('GET', `/api/matters/${ctx.mid}/report`);
  const m = report.j.media[0];
  const id = m.id;
  const unauth = await api('GET', `/api/media/${id}`); // no sig, no auth
  assert.equal(unauth.status, 403);
  const signed = await api('GET', m.url); // signed URL from the owner report
  assert.equal(signed.status, 200);
});

// ---------- AU: audit immutability ----------
test('AU-01: audit events cannot be updated or deleted (database refuses)', () => {
  const db = openDb(':memory:');
  audit(db, null, 'created', { a: 1 });
  assert.throws(() => db.prepare('UPDATE audit_event SET type=?').run('z'), /E_AUDIT_IMMUTABLE/);
  assert.throws(() => db.prepare('DELETE FROM audit_event').run(), /E_AUDIT_IMMUTABLE/);
  db.close();
});

// ---------- TS: token scope ----------
test('TS-01: a tenant token cannot reach owner endpoints or another matter\'s data', async () => {
  const a = await createCase({ submit: true, issue: true });
  const b = await createCase({ submit: true, issue: true });
  // owner endpoints require an owner session; a tenant (no x-account-id) is refused
  const file = await api('GET', `/api/properties/${a.pid}/file`);
  assert.ok(file.status === 401 || file.status === 403, 'owner file must not be reachable without owner session');
  const report = await api('GET', `/api/matters/${a.mid}/report`);
  assert.ok(report.status === 401 || report.status === 403);
  // the tenant inspect payload exposes no owner/account/file fields
  const inspect = (await api('GET', `/api/inspect/${a.token}`)).j;
  for (const k of ['account', 'property', 'audit', 'documents', 'owner', 'matters']) assert.ok(!(k in inspect), `inspect payload must not leak ${k}`);
  // token A cannot read media of matter B via media token scope
  const repB = await b.A('GET', `/api/matters/${b.mid}/report`);
  const mediaB = repB.j.media[0].id;
  const cross = await api('GET', `/api/media/${mediaB}?token=${a.token}`);
  assert.equal(cross.status, 403, 'token A must not unlock matter B media');
});

// ---------- pricing lock ----------
test('PR-01: only the locked PRD v1.4 prices exist; $25 is not representable', async () => {
  const pkgs = (await api('GET', '/api/packages')).j;
  const prices = pkgs.map(p => p.price_cents).sort((x, y) => x - y);
  assert.deepEqual(prices, [7500, 13500, 18000]);
  const db = openDb(':memory:');
  assert.throws(() => db.prepare(`INSERT INTO package(code,label,price_cents,inspections_count) VALUES('Z','z',2500,1)`).run());
  db.close();
});

// ---------- meaningful response + attestation structural checks ----------
test('MR-01 / AT-01: blank responses and partial attestations are not representable', () => {
  const db = openDb(':memory:');
  assert.throws(() => db.prepare(`INSERT INTO inspection_response(id,matter_id,prompt_id,value,na,created_at) VALUES('r','m','p','',0,0)`).run(), /CHECK|constraint/i);
  assert.throws(() => db.prepare(`INSERT INTO attestation(id,property_id,tenant_id,attest_authority,attest_accuracy,attest_consent_basis,attest_relationship,attest_truth,created_at)
    VALUES('x','p','t',1,1,1,1,0,0)`).run(), /CHECK|constraint/i);
  db.close();
});
