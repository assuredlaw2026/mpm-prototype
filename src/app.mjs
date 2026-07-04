// MPM prototype — application layer (router + domain logic + gates).
import crypto from 'node:crypto';
import { now, audit, getConfig, setConfig, activeRuleSet, HIGH_RISK_CATEGORIES } from './db.mjs';

const FORBIDDEN_TERMS = [
  'guarantee','guaranteed','legal advice','attorney-client','court-ready',
  'certified inspection','independent inspection','official eviction','win your case',
  'legally sufficient','$25'
];
const PACKET_DISCLAIMER =
  'This packet contains tenant-submitted photos and information collected through MyPropertyManager.com. ' +
  'It is a record for the property owner. It is not a legal inspection, not legal advice, and not a guarantee of any outcome. ' +
  'The owner is the author of any notice or action taken from this record.';

const uuid = () => crypto.randomUUID();
const ok = (body, status = 200) => ({ status, body });
const err = (status, code, message, extra = {}) => ({ status, body: { error: code, message, ...extra } });

function copyLint(text) {
  if (text == null) return null;
  const low = String(text).toLowerCase();
  for (const t of FORBIDDEN_TERMS) if (low.includes(t)) return t;
  return null;
}

export function buildApp(db) {
  // ---- auth helpers ----
  const account = (headers) => {
    const id = headers['x-account-id'];
    if (!id) return null;
    return db.prepare('SELECT * FROM account WHERE id=?').get(id) || null;
  };
  const ownedProperty = (acc, pid) =>
    acc && db.prepare('SELECT * FROM property WHERE id=? AND account_id=?').get(pid, acc.id);
  const ownedMatter = (acc, mid) =>
    acc && db.prepare(`SELECT m.* FROM inspection_matter m JOIN property p ON p.id=m.property_id
                       WHERE m.id=? AND p.account_id=?`).get(mid, acc.id);
  const matterByToken = (token) =>
    db.prepare('SELECT * FROM inspection_matter WHERE token=?').get(token);

  function signMedia(id) {
    const exp = now(db) + 5 * 60 * 1000;
    const sig = crypto.createHmac('sha256', getConfig(db, 'media_secret')).update(`${id}|${exp}`).digest('hex');
    return `/api/media/${id}?exp=${exp}&sig=${sig}`;
  }
  function verifyMediaSig(id, exp, sig) {
    if (!exp || !sig) return false;
    if (now(db) > Number(exp)) return false;
    const expect = crypto.createHmac('sha256', getConfig(db, 'media_secret')).update(`${id}|${exp}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
  }

  // ---- finding predicate evaluation (Determinism Patch v1.3 oracle) ----
  function evaluateFinding(matter, issue) {
    const rs = activeRuleSet(db);
    const categories = JSON.parse(rs.high_risk_categories);
    const disp = db.prepare('SELECT * FROM owner_issue_disposition WHERE issue_id=? ORDER BY created_at DESC LIMIT 1').get(issue.id);
    const lease = db.prepare('SELECT * FROM lease_obligation_evidence WHERE matter_id=? LIMIT 1').get(matter.id);
    const reasons = [];

    // classification gate
    if (!disp) reasons.push('no_owner_disposition');
    else if (disp.classification !== 'tenant_responsibility_possible') reasons.push('classification_' + disp.classification);
    // owner facts required
    if (!disp || !disp.owner_facts || !String(disp.owner_facts).trim()) reasons.push('no_owner_facts');
    // lease evidence required (Gate A)
    if (!lease) reasons.push('no_lease_evidence');
    // exposure required + threshold
    const exposure = disp ? disp.estimated_exposure_cents : null;
    if (exposure == null) reasons.push('exposure_unknown');
    else if (exposure > rs.exposure_threshold_cents) reasons.push('exposure_over_threshold');
    // evidence quality (fail closed)
    const media = db.prepare('SELECT * FROM media_asset WHERE response_id=?').all(issue.response_id);
    let quality = 'inadequate';
    if (media.length === 0) reasons.push('no_evidence');
    else {
      const allAdequate = media.every(m => m.review_quality_status === 'adequate'
        && m.upload_status === 'committed' && m.virus_scan_status === 'clean'
        && m.exif_stripped === 1 && m.file_hash);
      const anyUncertain = media.some(m => m.review_quality_status !== 'adequate');
      quality = allAdequate ? 'adequate' : 'inadequate';
      if (!allAdequate) reasons.push(anyUncertain ? 'evidence_uncertain' : 'evidence_inadequate');
    }
    // high-risk category
    if (categories.includes(issue.category)) reasons.push('category_' + issue.category);
    // ai confidence
    const aiUsed = issue.ai_confidence;
    if (aiUsed < rs.ai_confidence_threshold) reasons.push('ai_confidence_below_threshold');

    const highRisk = reasons.length > 0;
    const predValid = !highRisk ? 1 : 0;
    const pid = uuid();
    db.prepare(`INSERT INTO notice_predicate
      (id,matter_id,origin,predicate_valid,high_risk_result,high_risk_reasons,evidence_quality_result,
       estimated_exposure_cents,high_risk_rule_set_id,high_risk_rule_set_version,ai_confidence_used,
       attorney_routed,route,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        pid, matter.id, 'inspection_finding', predValid, highRisk ? 1 : 0,
        JSON.stringify(reasons), quality, exposure, rs.id, rs.version, aiUsed,
        highRisk ? 1 : 0, highRisk ? 'attorney_or_professional_review' : 'finding_eligible', now(db));
    if (highRisk) {
      db.prepare('INSERT INTO active_dispute_signal(id,property_id,matter_id,source_type,active,created_at) VALUES(?,?,?,?,1,?)')
        .run(uuid(), matter.property_id, matter.id, 'attorney_review_recommended', now(db));
    }
    audit(db, matter.id, 'finding_predicate_evaluated', { predicate_id: pid, predicate_valid: predValid, reasons });
    return db.prepare('SELECT * FROM notice_predicate WHERE id=?').get(pid);
  }

  // ---- routes ----
  const routes = [];
  const add = (method, pattern, handler) => routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  function match(method, pathParts) {
    for (const r of routes) {
      if (r.method !== method || r.parts.length !== pathParts.length) continue;
      const params = {}; let good = true;
      for (let i = 0; i < r.parts.length; i++) {
        if (r.parts[i].startsWith(':')) params[r.parts[i].slice(1)] = decodeURIComponent(pathParts[i]);
        else if (r.parts[i] !== pathParts[i]) { good = false; break; }
      }
      if (good) return { handler: r.handler, params };
    }
    return null;
  }

  // ===== PHASE 1 — owner onboarding & journey =====
  add('POST', '/api/accounts', (c) => {
    const { email, name } = c.body;
    if (!email || !name) return err(400, 'E_VALIDATION', 'email and name are required');
    if (db.prepare('SELECT 1 FROM account WHERE email=?').get(email)) return err(409, 'E_EXISTS', 'account already exists');
    const id = uuid();
    db.prepare('INSERT INTO account(id,email,name,created_at) VALUES(?,?,?,?)').run(id, email, name, now(db));
    return ok({ id, email, name });
  });
  add('POST', '/api/login', (c) => {
    const a = db.prepare('SELECT * FROM account WHERE email=?').get(c.body.email);
    return a ? ok({ id: a.id, email: a.email, name: a.name }) : err(404, 'E_NOT_FOUND', 'no such account');
  });
  add('GET', '/api/packages', () => ok(db.prepare('SELECT code,label,price_cents,inspections_count FROM package').all()));

  add('POST', '/api/properties', (c) => {
    const acc = account(c.headers); if (!acc) return err(401, 'E_AUTH', 'owner session required');
    const { address, jurisdiction } = c.body;
    if (!['NV', 'AZ', 'TX'].includes(jurisdiction)) return err(400, 'E_JURISDICTION', 'jurisdiction must be NV, AZ, or TX');
    const id = uuid();
    db.prepare('INSERT INTO property(id,account_id,address,jurisdiction,created_at) VALUES(?,?,?,?,?)').run(id, acc.id, address, jurisdiction, now(db));
    return ok({ id, address, jurisdiction });
  });
  add('GET', '/api/properties', (c) => {
    const acc = account(c.headers); if (!acc) return err(401, 'E_AUTH', 'owner session required');
    return ok(db.prepare('SELECT id,address,jurisdiction FROM property WHERE account_id=?').all(acc.id));
  });
  add('POST', '/api/properties/:id/tenants', (c) => {
    const acc = account(c.headers); const prop = ownedProperty(acc, c.params.id);
    if (!prop) return err(403, 'E_AUTH', 'not your property');
    const { name, phone, email } = c.body;
    const id = uuid();
    db.prepare('INSERT INTO tenant(id,property_id,name,phone,email,created_at) VALUES(?,?,?,?,?,?)').run(id, prop.id, name, phone || null, email || null, now(db));
    return ok({ id, name, phone, email });
  });
  add('POST', '/api/properties/:id/attestation', (c) => {
    const acc = account(c.headers); const prop = ownedProperty(acc, c.params.id);
    if (!prop) return err(403, 'E_AUTH', 'not your property');
    const b = c.body;
    const all = [b.authority, b.accuracy, b.consent_basis, b.relationship, b.truth].every(v => v === true);
    if (!all) return err(400, 'E_ATTESTATION_INCOMPLETE', 'all five owner affirmations must be true');
    const id = uuid();
    try {
      db.prepare(`INSERT INTO attestation(id,property_id,tenant_id,attest_authority,attest_accuracy,attest_consent_basis,attest_relationship,attest_truth,created_at)
                  VALUES(?,?,?,?,?,?,?,?,?)`).run(id, prop.id, b.tenant_id, 1, 1, 1, 1, 1, now(db));
    } catch (e) { return err(400, 'E_ATTESTATION_INVALID', e.message); }
    return ok({ id, complete: true });
  });
  add('POST', '/api/purchases', (c) => {
    const acc = account(c.headers); const prop = ownedProperty(acc, c.body.property_id);
    if (!prop) return err(403, 'E_AUTH', 'not your property');
    const pkg = db.prepare('SELECT * FROM package WHERE code=?').get(c.body.package_code);
    if (!pkg) return err(400, 'E_PACKAGE', 'unknown package');
    const id = uuid();
    db.prepare('INSERT INTO purchase(id,account_id,property_id,package_code,price_cents,status,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, acc.id, prop.id, pkg.code, pkg.price_cents, 'paid', now(db));
    return ok({ id, package: pkg.code, price_cents: pkg.price_cents, status: 'paid' });
  });
  add('POST', '/api/matters', (c) => {
    const acc = account(c.headers); const prop = ownedProperty(acc, c.body.property_id);
    if (!prop) return err(403, 'E_AUTH', 'not your property');
    const att = db.prepare('SELECT 1 FROM attestation WHERE property_id=? AND tenant_id=?').get(prop.id, c.body.tenant_id);
    if (!att) return err(409, 'E_ATTESTATION_INCOMPLETE', 'owner attestation required before an inspection can be created');
    const pur = db.prepare('SELECT * FROM purchase WHERE id=? AND property_id=? AND status=?').get(c.body.purchase_id, prop.id, 'paid');
    if (!pur) return err(402, 'E_PAYMENT_NOT_CONFIRMED', 'a paid purchase is required before an inspection can be created');
    const id = uuid(); const token = crypto.randomBytes(18).toString('base64url');
    const deadline = now(db) + 5 * 24 * 60 * 60 * 1000;
    db.prepare('INSERT INTO inspection_matter(id,property_id,tenant_id,purchase_id,token,status,deadline_at,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, prop.id, c.body.tenant_id, pur.id, token, 'created', deadline, now(db));
    audit(db, id, 'matter_created', {});
    return ok({ id, token, status: 'created', deadline_at: deadline });
  });
  add('POST', '/api/matters/:id/send-link', (c) => {
    const acc = account(c.headers); const m = ownedMatter(acc, c.params.id);
    if (!m) return err(403, 'E_AUTH', 'not your inspection');
    const channel = c.body.channel || 'sms';
    // Simulated dispatch only. No live carrier send happens here. Live SMS is gated (Phase 4).
    db.prepare('UPDATE inspection_matter SET status=? WHERE id=? AND status=?').run('link_sent', m.id, 'created');
    audit(db, m.id, 'link_sent_simulated', { channel });
    return ok({ status: 'link_sent', channel, simulated: true, tenant_link: `/inspect/${m.token}` });
  });

  // ===== PHASE 1 — tenant token-scoped inspection =====
  add('GET', '/api/inspect/:token', (c) => {
    const m = matterByToken(c.params.token); if (!m) return err(404, 'E_NOT_FOUND', 'invalid link');
    const prompts = db.prepare('SELECT id,grp,label,requires_media,mandatory FROM inspection_prompt ORDER BY mandatory DESC, grp').all();
    const responses = db.prepare('SELECT id,prompt_id,value,na,na_reason,condition,category FROM inspection_response WHERE matter_id=?').all(m.id);
    // token scope: tenant sees only inspection-relevant fields, never owner/account/file data
    return ok({ status: m.status, deadline_at: m.deadline_at, prompts, responses });
  });
  add('POST', '/api/inspect/:token/consent', (c) => {
    const m = matterByToken(c.params.token); if (!m) return err(404, 'E_NOT_FOUND', 'invalid link');
    if (c.body.participate === false) {
      db.prepare('UPDATE inspection_matter SET status=? WHERE id=?').run('declined', m.id);
      audit(db, m.id, 'declined_media_capture', {});
      return ok({ status: 'declined', message: 'You have declined to participate. This is recorded neutrally.' });
    }
    db.prepare("UPDATE inspection_matter SET status='consented' WHERE id=? AND status IN ('link_sent','created')").run(m.id);
    audit(db, m.id, 'consented', {});
    return ok({ status: 'consented' });
  });
  add('POST', '/api/inspect/:token/response', (c) => {
    const m = matterByToken(c.params.token); if (!m) return err(404, 'E_NOT_FOUND', 'invalid link');
    if (!['consented', 'in_progress'].includes(m.status)) return err(409, 'E_STATE', `cannot add a response while status is ${m.status}`);
    const b = c.body; const id = uuid();
    try {
      db.prepare(`INSERT INTO inspection_response(id,matter_id,prompt_id,value,na,na_reason,condition,category,created_at)
                  VALUES(?,?,?,?,?,?,?,?,?)`).run(id, m.id, b.prompt_id, b.value ?? null, b.na ? 1 : 0, b.na_reason ?? null,
                  b.condition === 'issue' ? 'issue' : 'ok', b.category ?? null, now(db));
    } catch (e) { return err(400, 'E_MEANINGFUL_RESPONSE', 'a response must contain content or a valid N/A reason', { detail: e.message }); }
    // first committed capture marks "started" (a link-open does NOT)
    if (!m.started_at) db.prepare('UPDATE inspection_matter SET started_at=?, status=? WHERE id=?').run(now(db), 'in_progress', m.id);
    // simulated AI issue detection for flagged conditions
    if (b.condition === 'issue' && b.category) {
      const conf = (b.ai_confidence != null) ? Number(b.ai_confidence) : 0.9;
      db.prepare('INSERT INTO issue(id,matter_id,response_id,category,ai_confidence,ai_flag,created_at) VALUES(?,?,?,?,?,1,?)')
        .run(uuid(), m.id, id, b.category, conf, now(db));
    }
    return ok({ id, started: true });
  });
  add('POST', '/api/inspect/:token/media', (c) => {
    const m = matterByToken(c.params.token); if (!m) return err(404, 'E_NOT_FOUND', 'invalid link');
    const b = c.body; const id = uuid();
    // EXIF is stripped server-side before persistence; no GPS is ever stored.
    const quality = ['adequate', 'inadequate', 'uncertain'].includes(b.review_quality_status) ? b.review_quality_status : 'uncertain';
    try {
      db.prepare(`INSERT INTO media_asset(id,matter_id,response_id,kind,file_hash,exif_stripped,review_quality_status,created_at)
                  VALUES(?,?,?,?,?,1,?,?)`).run(id, m.id, b.response_id ?? null, b.kind || 'photo',
                  b.file_hash || crypto.randomBytes(8).toString('hex'), quality, now(db));
    } catch (e) { return err(400, 'E_MEDIA_INVALID', e.message); }
    return ok({ id, exif_stripped: true });
  });
  add('POST', '/api/inspect/:token/certify', (c) => {
    const m = matterByToken(c.params.token); if (!m) return err(404, 'E_NOT_FOUND', 'invalid link');
    if (!['in_progress', 'consented'].includes(m.status)) return err(409, 'E_STATE', `cannot certify from status ${m.status}`);
    // completeness BEFORE certification: every mandatory prompt answered + required media present
    const mandatory = db.prepare('SELECT * FROM inspection_prompt WHERE mandatory=1').all();
    const missing = [];
    for (const p of mandatory) {
      const r = db.prepare('SELECT * FROM inspection_response WHERE matter_id=? AND prompt_id=?').get(m.id, p.id);
      if (!r) { missing.push({ prompt: p.id, why: 'no_response' }); continue; }
      if (p.requires_media && !r.na) {
        const media = db.prepare('SELECT 1 FROM media_asset WHERE response_id=?').get(r.id);
        if (!media) missing.push({ prompt: p.id, why: 'missing_media' });
      }
    }
    if (missing.length) return err(409, 'E_INCOMPLETE', 'inspection is not complete; certification is blocked', { missing });
    const t = now(db);
    let status;
    if (t <= m.deadline_at) status = 'submitted';
    else if (m.started_at && m.started_at <= m.deadline_at) status = 'submitted_late'; // grace: started before deadline
    else return err(409, 'E_DEADLINE_PASSED', 'the deadline passed before this inspection was started');
    db.prepare('UPDATE inspection_matter SET status=?, submitted_at=? WHERE id=?').run(status, t, m.id);
    audit(db, m.id, 'submitted', { status });
    return ok({ status });
  });
  add('POST', '/api/inspect/:token/withdraw', (c) => {
    const m = matterByToken(c.params.token); if (!m) return err(404, 'E_NOT_FOUND', 'invalid link');
    const any = db.prepare('SELECT 1 FROM inspection_response WHERE matter_id=?').get(m.id);
    if (any) {
      db.prepare('UPDATE inspection_matter SET status=?, partial_reason=? WHERE id=?').run('partial_submission', 'consent_withdrawn_after_start', m.id);
      audit(db, m.id, 'partial_submission', { reason: 'consent_withdrawn_after_start' });
      return ok({ status: 'partial_submission', reason: 'consent_withdrawn_after_start' });
    }
    db.prepare("UPDATE inspection_matter SET status='declined' WHERE id=?").run(m.id);
    return ok({ status: 'declined' });
  });

  // ===== PHASE 1 — owner report, property file, export =====
  add('GET', '/api/matters/:id/report', (c) => {
    const acc = account(c.headers); const m = ownedMatter(acc, c.params.id);
    if (!m) return err(403, 'E_AUTH', 'not your inspection');
    const responses = db.prepare('SELECT id,prompt_id,value,na,na_reason,condition,category FROM inspection_response WHERE matter_id=?').all(m.id);
    const issues = db.prepare('SELECT id,response_id,category,ai_confidence FROM issue WHERE matter_id=?').all(m.id);
    const media = db.prepare('SELECT id,response_id,kind,review_quality_status FROM media_asset WHERE matter_id=?').all(m.id)
      .map(x => ({ ...x, url: signMedia(x.id) }));
    return ok({ status: m.status, responses, issues, media });
  });
  add('GET', '/api/properties/:id/file', (c) => {
    const acc = account(c.headers); const prop = ownedProperty(acc, c.params.id);
    if (!prop) return err(403, 'E_AUTH', 'not your property');
    const matters = db.prepare('SELECT id,status,created_at,submitted_at FROM inspection_matter WHERE property_id=?').all(prop.id);
    const documents = db.prepare('SELECT id,kind,created_at FROM document WHERE property_id=?').all(prop.id);
    const disputes = db.prepare('SELECT id,source_type,active FROM active_dispute_signal WHERE property_id=?').all(prop.id);
    const auditTrail = db.prepare(`SELECT a.type,a.detail,a.created_at FROM audit_event a
      JOIN inspection_matter m ON m.id=a.matter_id WHERE m.property_id=? ORDER BY a.created_at`).all(prop.id);
    return ok({ property: { id: prop.id, address: prop.address, jurisdiction: prop.jurisdiction }, matters, documents, disputes, audit: auditTrail });
  });
  add('POST', '/api/matters/:id/export', (c) => {
    const acc = account(c.headers); const m = ownedMatter(acc, c.params.id);
    if (!m) return err(403, 'E_AUTH', 'not your inspection');
    const id = uuid();
    db.prepare('INSERT INTO packet_export(id,matter_id,disclaimer,created_at) VALUES(?,?,?,?)').run(id, m.id, PACKET_DISCLAIMER, now(db));
    audit(db, m.id, 'packet_exported', { packet_id: id });
    const responses = db.prepare('SELECT count(*) c FROM inspection_response WHERE matter_id=?').get(m.id).c;
    const media = db.prepare('SELECT count(*) c FROM media_asset WHERE matter_id=?').get(m.id).c;
    return ok({ id, disclaimer: PACKET_DISCLAIMER, contents: { responses, media }, message: 'Defensible File Packet created (tenant-submitted record).' });
  });

  // media access: signed URL only; owner of matter or valid tenant token; never public
  add('GET', '/api/media/:id', (c) => {
    const asset = db.prepare('SELECT * FROM media_asset WHERE id=?').get(c.params.id);
    if (!asset) return err(404, 'E_NOT_FOUND', 'no such media');
    const okSig = verifyMediaSig(asset.id, c.query.exp, c.query.sig);
    const acc = account(c.headers); const ownerOk = acc && ownedMatter(acc, asset.matter_id);
    const tokenOk = c.query.token && matterByToken(c.query.token)?.id === asset.matter_id;
    if (!okSig && !ownerOk && !tokenOk) return err(403, 'E_FORBIDDEN', 'media is private; a signed URL or authorized session is required');
    return ok({ id: asset.id, kind: asset.kind, file_hash: asset.file_hash, note: 'binary omitted in prototype; access authorized' });
  });

  // ===== finding predicate =====
  add('POST', '/api/issues/:id/disposition', (c) => {
    const acc = account(c.headers); if (!acc) return err(401, 'E_AUTH', 'owner session required');
    const issue = db.prepare('SELECT * FROM issue WHERE id=?').get(c.params.id);
    if (!issue || !ownedMatter(acc, issue.matter_id)) return err(403, 'E_AUTH', 'not your issue');
    const term = copyLint(c.body.owner_facts);
    if (term) return err(400, 'E_COPY_FORBIDDEN_TERM', `owner text contains a forbidden term: ${term}`, { term });
    const id = uuid();
    try {
      db.prepare(`INSERT INTO owner_issue_disposition(id,issue_id,classification,owner_facts,estimated_exposure_cents,created_at)
                  VALUES(?,?,?,?,?,?)`).run(id, issue.id, c.body.classification, c.body.owner_facts ?? null,
                  c.body.estimated_exposure_cents ?? null, now(db));
    } catch (e) { return err(400, 'E_DISPOSITION_INVALID', e.message); }
    return ok({ id, classification: c.body.classification });
  });
  add('POST', '/api/matters/:id/lease-evidence', (c) => {
    const acc = account(c.headers); const m = ownedMatter(acc, c.params.id);
    if (!m) return err(403, 'E_AUTH', 'not your inspection');
    const term = copyLint(c.body.owner_summary);
    if (term) return err(400, 'E_COPY_FORBIDDEN_TERM', `owner text contains a forbidden term: ${term}`, { term });
    if (c.body.owner_certifies !== true) return err(400, 'E_CERT_REQUIRED', 'owner must certify the clause applies');
    let docId = c.body.document_id;
    if (!docId) { docId = uuid(); db.prepare('INSERT INTO document(id,property_id,kind,file_hash,created_at) VALUES(?,?,?,?,?)').run(docId, m.property_id, 'lease', crypto.randomBytes(8).toString('hex'), now(db)); }
    const id = uuid();
    try {
      db.prepare(`INSERT INTO lease_obligation_evidence(id,matter_id,document_id,clause_reference,obligation_type,owner_summary,owner_certifies,created_at)
                  VALUES(?,?,?,?,?,?,1,?)`).run(id, m.id, docId, c.body.clause_reference || '', c.body.obligation_type || '', c.body.owner_summary || '', now(db));
    } catch (e) { return err(400, 'E_LEASE_EVIDENCE_INVALID', e.message); }
    return ok({ id, document_id: docId });
  });
  add('POST', '/api/matters/:id/finding-predicate', (c) => {
    const acc = account(c.headers); const m = ownedMatter(acc, c.params.id);
    if (!m) return err(403, 'E_AUTH', 'not your inspection');
    if (!['submitted', 'submitted_late'].includes(m.status))
      return err(409, 'E_NO_COMPLETED_INSPECTION', 'a finding predicate requires a completed (submitted) inspection');
    const issue = db.prepare('SELECT * FROM issue WHERE id=? AND matter_id=?').get(c.body.issue_id, m.id);
    if (!issue) return err(404, 'E_NOT_FOUND', 'issue not found for this inspection');
    const pred = evaluateFinding(m, issue);
    return ok({
      predicate_id: pred.id,
      predicate_valid: !!pred.predicate_valid,
      high_risk_result: !!pred.high_risk_result,
      reasons: JSON.parse(pred.high_risk_reasons || '[]'),
      evidence_quality_result: pred.evidence_quality_result,
      route: pred.route,
      rule_set_version: pred.high_risk_rule_set_version,
      ai_confidence_used: pred.ai_confidence_used
    });
  });

  // ===== PHASE 2 — incomplete workflow, cooperation, eligibility, attorney off-ramp =====
  add('POST', '/api/matters/:id/resolve-timeout', (c) => {
    const acc = account(c.headers); const m = ownedMatter(acc, c.params.id);
    if (!m) return err(403, 'E_AUTH', 'not your inspection');
    const t = now(db);
    if (['submitted', 'submitted_late'].includes(m.status)) return ok({ status: m.status });
    // Grace (24h) applies ONLY if the tenant started before the deadline. A never-started
    // matter resolves to Not Completed at the deadline itself (Day 6 owner workflow).
    const startedInTime = m.started_at && m.started_at <= m.deadline_at;
    const cutoff = startedInTime ? m.deadline_at + 24 * 60 * 60 * 1000 : m.deadline_at;
    if (t <= cutoff) return err(409, 'E_NOT_YET', 'the deadline (and grace window, if the tenant started in time) has not elapsed');
    const any = db.prepare('SELECT 1 FROM inspection_response WHERE matter_id=?').get(m.id);
    const status = any ? 'partial_submission' : 'not_completed';
    db.prepare('UPDATE inspection_matter SET status=? WHERE id=?').run(status, m.id);
    audit(db, m.id, 'timeout_resolved', { status });
    return ok({ status });
  });
  add('POST', '/api/matters/:id/cooperation-request', (c) => {
    const acc = account(c.headers); const m = ownedMatter(acc, c.params.id);
    if (!m) return err(403, 'E_AUTH', 'not your inspection');
    if (!['not_completed', 'partial_submission', 'declined'].includes(m.status))
      return err(409, 'E_STATE', 'a cooperation request applies only to non-completed, partial, or declined inspections');
    const id = uuid(); const t = now(db); const expires = t + 48 * 60 * 60 * 1000;
    db.prepare('INSERT INTO cooperation_request(id,matter_id,sent_at,window_expires_at,created_at) VALUES(?,?,?,?,?)').run(id, m.id, t, expires, t);
    audit(db, m.id, 'final_cooperation_request_sent', { window_expires_at: expires });
    return ok({ id, window_expires_at: expires, message: 'A neutral Final Inspection Cooperation Request has been recorded with a 48-hour window.' });
  });
  add('POST', '/api/matters/:id/notice-eligibility', (c) => {
    const acc = account(c.headers); const m = ownedMatter(acc, c.params.id);
    if (!m) return err(403, 'E_AUTH', 'not your inspection');
    const origin = c.body.origin;
    if (origin !== 'inspection_noncompletion')
      return err(400, 'E_ORIGIN', 'this endpoint evaluates the inspection_noncompletion origin; findings use /finding-predicate');

    const screen = c.body.screen || {};
    // Gate A: lawful basis = a cooperation request whose 48h window has expired without completion
    const coop = db.prepare('SELECT * FROM cooperation_request WHERE matter_id=? ORDER BY created_at DESC LIMIT 1').get(m.id);
    const gateA = coop && now(db) >= coop.window_expires_at && !coop.completed_within_window ? 1 : 0;
    // Gate B: identified tenancy/relationship (attestation on file)
    const gateB = db.prepare('SELECT 1 FROM attestation WHERE property_id=? AND tenant_id=?').get(m.property_id, m.tenant_id) ? 1 : 0;
    // Gate C: no retaliation / protected activity (fail closed on unsure)
    const gateC = screen.protected_activity === false ? 1 : 0;
    // Gate D: no disputed facts (fail closed on unsure)
    const gateD = screen.disputed_facts === false ? 1 : 0;
    // Gate E: jurisdiction has approved state notice content available
    const prop = db.prepare('SELECT * FROM property WHERE id=?').get(m.property_id);
    const mod = db.prepare('SELECT available FROM state_notice_module WHERE jurisdiction=?').get(prop.jurisdiction);
    const gateE = mod && mod.available === 1 ? 1 : 0;

    const allGates = gateA && gateB && gateC && gateD && gateE;
    const attorneyRouted = allGates ? 0 : 1;
    const predValid = allGates ? 1 : 0;

    const pid = uuid();
    db.prepare(`INSERT INTO notice_predicate(id,matter_id,origin,predicate_valid,attorney_routed,route,created_at)
                VALUES(?,?,?,?,?,?,?)`).run(pid, m.id, 'inspection_noncompletion', predValid, attorneyRouted,
                attorneyRouted ? 'attorney_or_professional_review' : 'noncompletion_eligible', now(db));
    const nid = uuid();
    db.prepare(`INSERT INTO notice_matter(id,predicate_id,property_id,predicate_valid,gate_a,gate_b,gate_c,gate_d,gate_e,
                state_module_available,attorney_routed,owner_approved,sendable,status,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,0,0,?,?)`).run(nid, pid, m.property_id, predValid, gateA, gateB, gateC, gateD, gateE,
                gateE, attorneyRouted, attorneyRouted ? 'attorney_review' : 'draft', now(db));
    if (attorneyRouted) {
      db.prepare('INSERT INTO active_dispute_signal(id,property_id,matter_id,source_type,active,created_at) VALUES(?,?,?,?,1,?)')
        .run(uuid(), m.property_id, m.id, 'attorney_review_recommended', now(db));
    }
    audit(db, m.id, 'notice_eligibility_evaluated', { gates: { gateA, gateB, gateC, gateD, gateE }, attorney_routed: attorneyRouted });
    return ok({
      notice_matter_id: nid, predicate_id: pid, predicate_valid: !!predValid,
      gates: { A: !!gateA, B: !!gateB, C: !!gateC, D: !!gateD, E: !!gateE },
      attorney_routed: !!attorneyRouted,
      route: attorneyRouted ? 'attorney_or_professional_review' : 'noncompletion_eligible',
      state_module_available: !!gateE,
      sendable: false
    });
  });

  // ===== notice approval & mailing (gated) =====
  add('POST', '/api/notice-matters/:id/approve', (c) => {
    const acc = account(c.headers); if (!acc) return err(401, 'E_AUTH', 'owner session required');
    const nm = db.prepare('SELECT * FROM notice_matter WHERE id=?').get(c.params.id);
    if (!nm || !ownedProperty(acc, nm.property_id)) return err(403, 'E_AUTH', 'not your notice');
    if (nm.attorney_routed) return err(409, 'E_ATTORNEY_REVIEW', 'this matter is routed to attorney review and cannot be owner-approved');
    if (!nm.predicate_valid) return err(409, 'E_PREDICATE_INVALID', 'no valid predicate');
    if (!nm.state_module_available) return err(409, 'E_STATE_MODULE_UNAVAILABLE', 'no approved state notice content for this jurisdiction');
    const sendable = (nm.predicate_valid && nm.gate_a && nm.gate_b && nm.gate_c && nm.gate_d && nm.gate_e
      && nm.state_module_available && !nm.attorney_routed) ? 1 : 0;
    db.prepare('UPDATE notice_matter SET owner_approved=1, sendable=?, status=? WHERE id=?').run(sendable, sendable ? 'approved' : 'draft', nm.id);
    audit(db, null, 'notice_approved', { notice_matter_id: nm.id, sendable: !!sendable });
    return ok({ id: nm.id, owner_approved: true, sendable: !!sendable });
  });
  add('POST', '/api/notice-matters/:id/mail', (c) => {
    const acc = account(c.headers); if (!acc) return err(401, 'E_AUTH', 'owner session required');
    const nm = db.prepare('SELECT * FROM notice_matter WHERE id=?').get(c.params.id);
    if (!nm || !ownedProperty(acc, nm.property_id)) return err(403, 'E_AUTH', 'not your notice');
    if (!nm.owner_approved) return err(409, 'E_NOTICE_NOT_APPROVED', 'owner approval is required before mailing');
    try {
      db.prepare('INSERT INTO mail_job(id,notice_matter_id,status,created_at) VALUES(?,?,?,?)').run(uuid(), nm.id, 'queued', now(db));
    } catch (e) {
      return err(409, 'E_NOTICE_NOT_SENDABLE', 'mailing blocked: the notice is not sendable (a gate is unmet)', { detail: e.message });
    }
    audit(db, null, 'mail_job_created', { notice_matter_id: nm.id });
    return ok({ status: 'queued', simulated: true });
  });

  // ===== PHASE 4 — live capabilities, gated until counsel clears them =====
  add('POST', '/api/live/sms', (c) => {
    if (getConfig(db, 'tcpa_counsel_approved') !== '1')
      return err(403, 'E_TCPA_NOT_APPROVED', 'live SMS is blocked until TCPA counsel approval is recorded');
    return ok({ status: 'sent', live: true });
  });
  add('POST', '/api/live/notice-generate', (c) => {
    // Gated stub: fails closed on any missing/unknown input. In MVP no state module is
    // available, so this endpoint never generates; it must refuse cleanly, never 500.
    const m = c.body.matter_id ? db.prepare('SELECT * FROM inspection_matter WHERE id=?').get(c.body.matter_id) : null;
    const prop = m ? db.prepare('SELECT * FROM property WHERE id=?').get(m.property_id) : null;
    const mod = prop ? db.prepare('SELECT available FROM state_notice_module WHERE jurisdiction=?').get(prop.jurisdiction) : null;
    if (!mod || mod.available !== 1)
      return err(403, 'E_STATE_MODULE_UNAVAILABLE', 'live notice generation is blocked until approved state notice content exists');
    return ok({ status: 'generated', live: true });
  });

  // ===== dev-only controls (simulate counsel gates / clock; not part of owner/tenant UI) =====
  add('POST', '/api/dev/clock', (c) => { setConfig(db, 'clock_offset_ms', Number(getConfig(db, 'clock_offset_ms') || 0) + Number(c.body.advance_ms || 0)); return ok({ clock_offset_ms: Number(getConfig(db, 'clock_offset_ms')) }); });
  add('POST', '/api/dev/matter/:id/expire-deadline', (c) => { const m = db.prepare('SELECT * FROM inspection_matter WHERE id=?').get(c.params.id); if (!m) return err(404, 'E_NOT_FOUND', 'no matter'); db.prepare('UPDATE inspection_matter SET deadline_at=? WHERE id=?').run(now(db) - 1000, m.id); return ok({ ok: true }); });
  add('POST', '/api/dev/tcpa', (c) => { setConfig(db, 'tcpa_counsel_approved', c.body.approved ? '1' : '0'); return ok({ tcpa_counsel_approved: getConfig(db, 'tcpa_counsel_approved') }); });
  add('POST', '/api/dev/state-module', (c) => { db.prepare('UPDATE state_notice_module SET available=? WHERE jurisdiction=?').run(c.body.available ? 1 : 0, c.body.jurisdiction); return ok({ jurisdiction: c.body.jurisdiction, available: c.body.available ? 1 : 0 }); });
  add('POST', '/api/copy-lint', (c) => { const t = copyLint(c.body.text); return t ? err(400, 'E_COPY_FORBIDDEN_TERM', `forbidden term: ${t}`, { term: t }) : ok({ ok: true }); });

  // dispatcher
  return function route(method, pathname, query, body, headers) {
    const parts = pathname.split('/').filter(Boolean);
    const m = match(method, parts);
    if (!m) return err(404, 'E_NO_ROUTE', `no route for ${method} ${pathname}`);
    try {
      return m.handler({ params: m.params, query: query || {}, body: body || {}, headers: headers || {} });
    } catch (e) {
      return err(500, 'E_INTERNAL', e.message);
    }
  };
}

export { copyLint, FORBIDDEN_TERMS, PACKET_DISCLAIMER };
