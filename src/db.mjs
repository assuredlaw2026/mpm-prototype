// MPM prototype — database layer.
// Real compliance enforcement lives here: CHECK constraints make non-compliant
// rows unrepresentable, and triggers block audit mutation and unsendable mailing.
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

const SCHEMA = `
PRAGMA foreign_keys = ON;

-- key/value config (clock offset, counsel flags, secrets)
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- versioned, legal/product-owned high-risk rule set (Determinism Patch v1.3)
CREATE TABLE IF NOT EXISTS high_risk_rule_set (
  id INTEGER PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  ai_confidence_threshold REAL NOT NULL,
  exposure_threshold_cents INTEGER NOT NULL,
  high_risk_categories TEXT NOT NULL,        -- json array
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  owner TEXT NOT NULL DEFAULT 'legal_product'
);

-- state notice modules: content is legal/product-owned; absence => attorney review
CREATE TABLE IF NOT EXISTS state_notice_module (
  jurisdiction TEXT PRIMARY KEY CHECK (jurisdiction IN ('NV','AZ','TX')),
  available INTEGER NOT NULL CHECK (available IN (0,1))
);

-- pricing is locked to PRD v1.4 figures; any other price is unrepresentable
CREATE TABLE IF NOT EXISTS package (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents IN (7500,13500,18000)),
  inspections_count INTEGER NOT NULL CHECK (inspections_count IN (1,2,4))
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS owner_entity (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  entity_type TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS property (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id),
  address TEXT NOT NULL,
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('NV','AZ','TX')),
  owner_entity_id TEXT REFERENCES owner_entity(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES property(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  created_at INTEGER NOT NULL
);

-- owner attestation: all five affirmations must be true or the row cannot exist
CREATE TABLE IF NOT EXISTS attestation (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES property(id),
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  attest_authority INTEGER NOT NULL,
  attest_accuracy INTEGER NOT NULL,
  attest_consent_basis INTEGER NOT NULL,
  attest_relationship INTEGER NOT NULL,
  attest_truth INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (attest_authority=1 AND attest_accuracy=1 AND attest_consent_basis=1
         AND attest_relationship=1 AND attest_truth=1)
);

-- payment must be confirmed; no other status is allowed for a usable purchase
CREATE TABLE IF NOT EXISTS purchase (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id),
  property_id TEXT NOT NULL REFERENCES property(id),
  package_code TEXT NOT NULL REFERENCES package(code),
  price_cents INTEGER NOT NULL CHECK (price_cents IN (7500,13500,18000)),
  status TEXT NOT NULL CHECK (status IN ('paid')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inspection_matter (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES property(id),
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  purchase_id TEXT NOT NULL REFERENCES purchase(id),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'created','link_sent','consented','declined','in_progress',
    'submitted','submitted_late','partial_submission','owner_accepted_partial','not_completed')),
  started_at INTEGER,
  deadline_at INTEGER NOT NULL,
  submitted_at INTEGER,
  partial_reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inspection_prompt (
  id TEXT PRIMARY KEY,
  grp TEXT NOT NULL,
  label TEXT NOT NULL,
  requires_media INTEGER NOT NULL CHECK (requires_media IN (0,1)),
  mandatory INTEGER NOT NULL CHECK (mandatory IN (0,1))
);

-- a response is meaningful or it does not exist (no blank/placeholder rows)
CREATE TABLE IF NOT EXISTS inspection_response (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES inspection_matter(id),
  prompt_id TEXT NOT NULL REFERENCES inspection_prompt(id),
  value TEXT,
  na INTEGER NOT NULL DEFAULT 0 CHECK (na IN (0,1)),
  na_reason TEXT,
  condition TEXT NOT NULL DEFAULT 'ok' CHECK (condition IN ('ok','issue')),
  category TEXT,
  created_at INTEGER NOT NULL,
  CHECK (
    (na=1 AND na_reason IS NOT NULL AND length(trim(na_reason))>0)
    OR (na=0 AND value IS NOT NULL AND length(trim(value))>0)
  )
);

-- media: EXIF must be stripped; only committed+clean assets exist; no GPS columns at all
CREATE TABLE IF NOT EXISTS media_asset (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES inspection_matter(id),
  response_id TEXT REFERENCES inspection_response(id),
  kind TEXT NOT NULL CHECK (kind IN ('photo','video')),
  file_hash TEXT NOT NULL,
  upload_status TEXT NOT NULL DEFAULT 'committed' CHECK (upload_status IN ('committed')),
  virus_scan_status TEXT NOT NULL DEFAULT 'clean' CHECK (virus_scan_status IN ('clean')),
  exif_stripped INTEGER NOT NULL DEFAULT 1 CHECK (exif_stripped = 1),
  review_quality_status TEXT NOT NULL DEFAULT 'uncertain'
     CHECK (review_quality_status IN ('adequate','inadequate','uncertain')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS issue (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES inspection_matter(id),
  response_id TEXT REFERENCES inspection_response(id),
  category TEXT NOT NULL,
  ai_confidence REAL NOT NULL,
  ai_flag INTEGER NOT NULL DEFAULT 1 CHECK (ai_flag IN (0,1)),
  created_at INTEGER NOT NULL
);

-- owner classification enum; note 'send_default' is deliberately NOT a value
CREATE TABLE IF NOT EXISTS owner_issue_disposition (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issue(id),
  classification TEXT NOT NULL CHECK (classification IN (
    'owner_maintenance','tenant_responsibility_possible','mixed_or_unclear',
    'documentation_only','safety_or_habitability_review','professional_review_needed','unsure')),
  owner_facts TEXT,
  estimated_exposure_cents INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS document (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES property(id),
  kind TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lease_obligation_evidence (
  id TEXT PRIMARY KEY,
  predicate_id TEXT,
  matter_id TEXT NOT NULL REFERENCES inspection_matter(id),
  document_id TEXT NOT NULL REFERENCES document(id),
  clause_reference TEXT NOT NULL,
  obligation_type TEXT NOT NULL,
  owner_summary TEXT NOT NULL,
  owner_certifies INTEGER NOT NULL CHECK (owner_certifies = 1),
  created_at INTEGER NOT NULL
);

-- two-path notice predicate; *_later origins are not representable here
CREATE TABLE IF NOT EXISTS notice_predicate (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES inspection_matter(id),
  origin TEXT NOT NULL CHECK (origin IN ('inspection_noncompletion','inspection_finding')),
  predicate_valid INTEGER NOT NULL DEFAULT 0 CHECK (predicate_valid IN (0,1)),
  high_risk_result INTEGER NOT NULL DEFAULT 0 CHECK (high_risk_result IN (0,1)),
  high_risk_reasons TEXT,
  evidence_quality_result TEXT,
  estimated_exposure_cents INTEGER,
  high_risk_rule_set_id INTEGER REFERENCES high_risk_rule_set(id),
  high_risk_rule_set_version TEXT,
  ai_confidence_used REAL,
  attorney_routed INTEGER NOT NULL DEFAULT 0 CHECK (attorney_routed IN (0,1)),
  route TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cooperation_request (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES inspection_matter(id),
  sent_at INTEGER NOT NULL,
  window_expires_at INTEGER NOT NULL,
  completed_within_window INTEGER NOT NULL DEFAULT 0 CHECK (completed_within_window IN (0,1)),
  created_at INTEGER NOT NULL
);

-- a notice can be sendable ONLY if every gate passes. This is a structural CHECK:
-- sendable=1 is impossible to store unless all conditions hold in the same row.
CREATE TABLE IF NOT EXISTS notice_matter (
  id TEXT PRIMARY KEY,
  predicate_id TEXT NOT NULL REFERENCES notice_predicate(id),
  property_id TEXT NOT NULL REFERENCES property(id),
  predicate_valid INTEGER NOT NULL DEFAULT 0,
  gate_a INTEGER NOT NULL DEFAULT 0,
  gate_b INTEGER NOT NULL DEFAULT 0,
  gate_c INTEGER NOT NULL DEFAULT 0,
  gate_d INTEGER NOT NULL DEFAULT 0,
  gate_e INTEGER NOT NULL DEFAULT 0,
  state_module_available INTEGER NOT NULL DEFAULT 0,
  attorney_routed INTEGER NOT NULL DEFAULT 0,
  owner_approved INTEGER NOT NULL DEFAULT 0,
  sendable INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  CHECK (sendable IN (0,1)),
  CHECK (
    sendable = 0 OR (
      predicate_valid = 1 AND gate_a = 1 AND gate_b = 1 AND gate_c = 1
      AND gate_d = 1 AND gate_e = 1 AND state_module_available = 1
      AND attorney_routed = 0 AND owner_approved = 1
    )
  )
);

-- a mail job cannot be created for a non-sendable notice (cross-row, so a trigger)
CREATE TABLE IF NOT EXISTS mail_job (
  id TEXT PRIMARY KEY,
  notice_matter_id TEXT NOT NULL REFERENCES notice_matter(id),
  status TEXT NOT NULL DEFAULT 'queued',
  created_at INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS mail_job_requires_sendable
BEFORE INSERT ON mail_job
BEGIN
  SELECT CASE
    WHEN (SELECT sendable FROM notice_matter WHERE id = NEW.notice_matter_id) IS NOT 1
    THEN RAISE(ABORT, 'E_NOTICE_NOT_SENDABLE')
  END;
END;

CREATE TABLE IF NOT EXISTS active_dispute_signal (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES property(id),
  matter_id TEXT,
  source_type TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS packet_export (
  id TEXT PRIMARY KEY,
  matter_id TEXT NOT NULL REFERENCES inspection_matter(id),
  disclaimer TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- append-only audit log; updates and deletes are refused at the database
CREATE TABLE IF NOT EXISTS audit_event (
  id TEXT PRIMARY KEY,
  matter_id TEXT,
  type TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS audit_no_update
BEFORE UPDATE ON audit_event
BEGIN SELECT RAISE(ABORT, 'E_AUDIT_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS audit_no_delete
BEFORE DELETE ON audit_event
BEGIN SELECT RAISE(ABORT, 'E_AUDIT_IMMUTABLE'); END;
`;

const HIGH_RISK_CATEGORIES = [
  'safety','habitability','mold','water_intrusion','electrical','gas','structural',
  'fire','smoke_co_detector','locks_security','pool_spa','pest'
];

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  seed(db);
  return db;
}

function seedRow(db, sql, params) { try { db.prepare(sql).run(...params); } catch (e) { /* idempotent seed */ } }

export function seed(db) {
  const now = Date.now();
  // config
  for (const [k, v] of [
    ['clock_offset_ms', '0'],
    ['tcpa_counsel_approved', '0'],
    ['media_secret', crypto.randomBytes(16).toString('hex')]
  ]) seedRow(db, 'INSERT OR IGNORE INTO config(key,value) VALUES(?,?)', [k, v]);

  seedRow(db, `INSERT OR IGNORE INTO high_risk_rule_set
      (id,version,ai_confidence_threshold,exposure_threshold_cents,high_risk_categories,active)
      VALUES (1,'hrr-v1',0.75,100000,?,1)`, [JSON.stringify(HIGH_RISK_CATEGORIES)]);

  for (const j of ['NV','AZ','TX'])
    seedRow(db, 'INSERT OR IGNORE INTO state_notice_module(jurisdiction,available) VALUES(?,0)', [j]);

  for (const [code,label,price,count] of [
    ['SINGLE','Single inspection',7500,1],
    ['SEMIANNUAL','Semiannual (2 inspections)',13500,2],
    ['QUARTERLY','Quarterly (4 inspections, best value)',18000,4]
  ]) seedRow(db, 'INSERT OR IGNORE INTO package(code,label,price_cents,inspections_count) VALUES(?,?,?,?)',[code,label,price,count]);

  const prompts = [
    ['p_kitchen','kitchen','Kitchen — overall condition and any visible damage',1,1],
    ['p_bath','bathroom','Bathroom — overall condition and any leaks or damage',1,1],
    ['p_living','living','Living areas — walls, floors, windows condition',1,1],
    ['p_safety','smoke_co_detector','Smoke and carbon-monoxide detectors — present and functioning',1,1],
    ['p_general','general','Anything else you want to note (optional)',0,0]
  ];
  for (const [id,grp,label,rm,m] of prompts)
    seedRow(db, 'INSERT OR IGNORE INTO inspection_prompt(id,grp,label,requires_media,mandatory) VALUES(?,?,?,?,?)',[id,grp,label,rm,m]);
}

// ---- helpers ----
export function getConfig(db, key) {
  const r = db.prepare('SELECT value FROM config WHERE key=?').get(key);
  return r ? r.value : null;
}
export function setConfig(db, key, value) {
  db.prepare('INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
export function now(db) {
  return Date.now() + Number(getConfig(db, 'clock_offset_ms') || 0);
}
export function audit(db, matterId, type, detail) {
  db.prepare('INSERT INTO audit_event(id,matter_id,type,detail,created_at) VALUES(?,?,?,?,?)')
    .run(crypto.randomUUID(), matterId, type, detail ? JSON.stringify(detail) : null, now(db));
}
export function activeRuleSet(db) {
  return db.prepare('SELECT * FROM high_risk_rule_set WHERE active=1 ORDER BY id DESC LIMIT 1').get();
}
export { HIGH_RISK_CATEGORIES };
