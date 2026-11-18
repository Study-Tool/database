#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const relayBaseUrl = (process.env.RELAY_BASE_URL || "").replace(/\/+$/, "");
const exportSecret = process.env.EXPORT_SECRET || "";

if (!relayBaseUrl || !exportSecret) {
  console.error("Missing RELAY_BASE_URL or EXPORT_SECRET environment variables.");
  process.exit(1);
}

const ackArgIndex = process.argv.indexOf("--ack");
if (ackArgIndex !== -1) {
  const maxId = Number(process.argv[ackArgIndex + 1] || 0);
  if (!Number.isInteger(maxId) || maxId <= 0) {
    console.log("No pending submissions to acknowledge.");
    process.exit(0);
  }
  const ackRes = await fetch(`${relayBaseUrl}/v1/export/ack`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${exportSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ maxId }),
  });
  if (!ackRes.ok) {
    const errText = await ackRes.text();
    console.error(`Export ack failed (${ackRes.status}): ${errText}`);
    process.exit(1);
  }
  const ackData = await ackRes.json();
  console.log(`Acknowledged D1 export up to id=${ackData.ackedMaxId} (${ackData.updatedRows} row(s) marked exported).`);
  process.exit(0);
}

const dataDir = path.resolve(process.cwd(), "data");
const mergeScript = path.resolve(process.cwd(), "scripts", "merge_contributions.py");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(mergeScript)) {
  console.error(`Missing merge script at ${mergeScript}`);
  process.exit(1);
}

const response = await fetch(`${relayBaseUrl}/v1/export`, {
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
const maxId = Number(payload?.maxId || 0);
const subjects = payload?.subjects || {};
const subjectCodes = Object.keys(subjects);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `max_id=${maxId}\nhas_more=${Boolean(payload?.hasMore)}\n`);
}

if (subjectCodes.length === 0) {
  console.log("No pending community submissions to sync today.");
  process.exit(0);
}

let totalMerged = 0;
let totalConfirmations = 0;

for (const subjectCode of subjectCodes) {
  if (!/^[A-Z0-9_-]{2,16}$/.test(subjectCode)) continue;
  const questions = subjects[subjectCode];
  if (!Array.isArray(questions) || questions.length === 0) continue;

  const mergePayload = JSON.stringify({
    subjectCode,
    source: "d1_daily_export",
    questions
  });

  try {
    const out = execFileSync("python3", [mergeScript], {
      input: mergePayload,
      encoding: "utf8",
      cwd: process.cwd()
    });
    const summary = JSON.parse(out);
    totalMerged += Number(summary.newMerged || 0);
    totalConfirmations += Number(summary.updatedConfirmations || 0);
    console.log(`Merged ${subjectCode}: +${summary.newMerged || 0} new, ${summary.updatedConfirmations || 0} confirmations`);
  } catch (err) {
    console.error(`Skipping ${subjectCode} due to merge validation error:`, err?.stderr || err?.message || err);
  }
}

console.log(`Daily sync complete (maxId=${maxId}): +${totalMerged} new, ${totalConfirmations} confirmation updates.`);
