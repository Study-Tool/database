import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const workerSource = fs.readFileSync(fileURLToPath(new URL("./worker.js", import.meta.url)), "utf8")
  .replace("export default {", "globalThis.worker = {");
const context = vm.createContext({
  Response,
  Request,
  URL,
  TextEncoder,
  TextDecoder,
  crypto: webcrypto,
  btoa,
  atob,
  fetch: async (url) => {
    throw new Error(`Unexpected fetch ${url}`);
  }
});
vm.runInContext(workerSource, context, { filename: "worker.js" });
const worker = context.worker;

let markedExported = false;
const env = {
  EXPORT_SECRET: "super-secret-export-key",
  MIN_CLIENT_VERSION: "1.8.0",
  LATEST_CLIENT_VERSION: "2.0.0",
  MOODLE_SELECTORS_JSON: JSON.stringify({ quizForm: "#responseform" }),
  PUBLIC_HOMEPAGE_URL: "https://portal.amaes-toolkit.example/",
  PUBLIC_SUPPORT_URL: "https://portal.amaes-toolkit.example/support",
  PUBLIC_REPO_URL: "https://github.com/amaes-toolkit-org/amaes-toolkit",
  PUBLIC_DATABASE_URL: "https://github.com/amaes-toolkit-org/database",
  PUBLIC_MIRROR_URL: "https://codeberg.org/amaes-toolkit-org/amaes-toolkit",
  PUBLIC_EXTENSION_URL: "https://portal.amaes-toolkit.example/extension",
  DB: {
    prepare(sql) {
      return {
        async run() { return { meta: { changes: 1 } }; },
        async all() {
          if (sql.includes("FROM community_submissions")) {
            return {
              results: [
                {
                  id: 10,
                  subject_code: "CS6204",
                  source: "review_screen",
                  evidence_type: "moodle_review",
                  payload_json: JSON.stringify({
                    questions: [{ question: "Q1", answer: "A1", verified: true }]
                  }),
                  created_at: 1700000000000
                }
              ]
            };
          }
          return { results: [] };
        },
        bind(...params) {
          return {
            async run() {
              if (sql.includes("UPDATE community_submissions SET status = 'exported'")) {
                markedExported = params[1] === 10;
              }
              return { meta: { changes: 1 } };
            },
            async first() { return null; },
            async all() { return { results: [] }; }
          };
        }
      };
    }
  }
};

// 1. Verify GET /v1/config returns dynamic links without hardcoded Acads-Tools
const configRes = await worker.fetch(new Request("https://api.amaes-toolkit.example/v1/config"), env);
assert.equal(configRes.status, 200);
const configData = await configRes.json();
assert.equal(configData.minVersion, "1.8.0");
assert.equal(configData.latestVersion, "2.0.0");
assert.equal(configData.links.homepage, "https://portal.amaes-toolkit.example/");
assert.equal(configData.links.mirror, "https://codeberg.org/amaes-toolkit-org/amaes-toolkit");
assert.equal(configData.flags.autoQuiz, true);
assert.equal(configData.selectors.quizForm, "#responseform");

// 1b. Verify GET /version returns 200 with minimumVersion, latestVersion, and updateUrl
const versionRes = await worker.fetch(new Request("https://api.amaes-toolkit.example/version"), env);
assert.equal(versionRes.status, 200);
const versionData = await versionRes.json();
assert.equal(versionData.minimumVersion, "1.8.0");
assert.equal(versionData.latestVersion, "2.0.0");
assert.equal(versionData.updateUrl, "https://portal.amaes-toolkit.example/extension");

// 2. Verify GET /v1/export rejects missing/wrong secret
const unauthRes = await worker.fetch(new Request("https://api.amaes-toolkit.example/v1/export"), env);
assert.equal(unauthRes.status, 401);

// 3. Verify GET /v1/export is read-only and returns maxId/hasMore, then POST /v1/export/ack marks exported
const exportRes = await worker.fetch(new Request("https://api.amaes-toolkit.example/v1/export", {
  headers: { Authorization: "Bearer super-secret-export-key" }
}), env);
assert.equal(exportRes.status, 200);
const exportData = await exportRes.json();
assert.equal(exportData.submissionCount, 1);
assert.equal(exportData.subjectCount, 1);
assert.equal(exportData.maxId, 10);
assert.equal(exportData.hasMore, false);
assert.equal(exportData.subjects.CS6204.length, 1);
assert.equal(markedExported, false);

const ackRes = await worker.fetch(new Request("https://api.amaes-toolkit.example/v1/export/ack", {
  method: "POST",
  headers: {
    Authorization: "Bearer super-secret-export-key",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ maxId: exportData.maxId })
}), env);
assert.equal(ackRes.status, 200);
const ackData = await ackRes.json();
assert.equal(ackData.ackedMaxId, 10);
assert.equal(markedExported, true);

console.log("Config indirection and D1 export relay tests PASSED");
