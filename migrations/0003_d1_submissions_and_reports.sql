-- Migration: Store community submissions, anomaly reports, and bug reports directly in D1
-- Eliminates GitHub Issues API calls from the Cloudflare Worker to prevent automated issue-spam bans.

CREATE TABLE IF NOT EXISTS community_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_code TEXT NOT NULL,
  source TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  question_count INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  exported_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_community_submissions_status_subject
  ON community_submissions (status, subject_code, created_at);

CREATE TABLE IF NOT EXISTS anomaly_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  anomaly_type TEXT NOT NULL,
  subject_code TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bug_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
