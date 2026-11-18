#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const relayBaseUrl = (process.env.RELAY_BASE_URL || "").replace(/\/+$/, "");
const exportSecret = process.env.EXPORT_SECRET || "";

if (!relayBaseUrl || !exportSecret) {
  console.error("Missing RELAY_BASE_URL or EXPORT_SECRET environment variables.");
  process.exit(1);
}

const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function normalizeQuestionKey(text) {
  return String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

const response = await fetch(`${relayBaseUrl}/v1/export?markExported=1`, {
  headers: {
    Authorization: `Bearer ${exportSecret}`,
    Accept: "application/json"
  }
});

if (!response.ok) {
  const errText = await response.text();
  console.error(`Export request failed (${response.status}): ${errText}`);
  process.exit(1);
}

const payload = await response.json();
const subjects = payload?.subjects || {};
const subjectCodes = Object.keys(subjects);

if (subjectCodes.length === 0) {
  console.log("No pending community submissions to sync today.");
  process.exit(0);
}

let updatedFiles = 0;
let addedRecords = 0;

for (const subjectCode of subjectCodes) {
  if (!/^[A-Z0-9_-]{2,16}$/.test(subjectCode)) continue;
  const filePath = path.join(dataDir, `${subjectCode}.json`);
  let existing = { subjectCode, updatedAt: new Date().toISOString(), questions: [] };

  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed && Array.isArray(parsed.questions)) {
        existing = parsed;
      }
    } catch (_) {}
  }

  const seen = new Set(existing.questions.map(q => normalizeQuestionKey(q.question || q.qRaw)));
  let fileChanged = false;

  for (const incoming of subjects[subjectCode]) {
    const key = normalizeQuestionKey(incoming.question || incoming.qRaw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    existing.questions.push(incoming);
    addedRecords += 1;
    fileChanged = true;
  }

  if (fileChanged) {
    existing.subjectCode = subjectCode;
    existing.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
    updatedFiles += 1;
  }
}

console.log(`Synced ${addedRecords} new question records across ${updatedFiles} subject file(s).`);
