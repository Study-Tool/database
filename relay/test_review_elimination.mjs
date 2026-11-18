import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const githubRequests = [];
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
  fetch: async (url, init = {}) => {
    githubRequests.push({ url: String(url), body: init.body || "" });
    if (String(url).endsWith("/labels")) return new Response("already exists", { status: 422 });
    if (String(url).endsWith("/issues")) return new Response(JSON.stringify({ number: 42 }), { status: 201 });
    throw new Error(`Unexpected fetch ${url}`);
  }
});
vm.runInContext(workerSource, context, { filename: "worker.js" });
const worker = context.worker;
const env = {
  GITHUB_BOT_TOKEN: "test-token",
  DB: {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("SELECT COUNT(*) AS report_count")) {
                return { report_count: 0, last_reported_at: null };
              }
              return null;
            },
            async run() {
              return { meta: { changes: 1 } };
            }
          };
        },
        async run() {
          return { meta: { changes: 1 } };
        }
      };
    }
  }
};
const corsHeaders = { "Access-Control-Allow-Origin": "*" };

function contribution(question, source = "review_screen") {
  return new Request("https://relay.example/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subjectCode: "ITE6200",
      source,
      questions: [question]
    })
  });
}

const question = {
  question: "SSPR stands for",
  answer: "",
  choices: [],
  wrongAnswers: ["Self-service password reset"],
  wrongAnswerEvidence: true,
  verified: false,
  source: "review_screen",
  evidenceType: "moodle_review_elimination"
};

const insertedSubmissions = [];
env.DB = {
  prepare(sql) {
    return {
      bind(...params) {
        return {
          async first() { return null; },
          async all() { return { results: [] }; },
          async run() {
            if (sql.includes("INSERT INTO community_submissions")) {
              insertedSubmissions.push(JSON.parse(params[4]));
            }
            return { meta: { changes: 1 } };
          }
        };
      },
      async run() { return { meta: { changes: 1 } }; }
    };
  }
};

const invalid = await worker.fetch(contribution({
  ...question,
  evidenceType: "community_report"
}), env, { corsHeaders });
assert.equal(invalid.status, 400);
assert.equal(insertedSubmissions.length, 0, "Unproven answerless submissions must not reach D1");

const wrongSource = await worker.fetch(contribution(question, "background_harvester"), env, { corsHeaders });
assert.equal(wrongSource.status, 400);
assert.equal(insertedSubmissions.length, 0, "Only Moodle review submissions may share elimination-only evidence");

const accepted = await worker.fetch(contribution(question), env, { corsHeaders });
assert.equal(accepted.status, 200);
assert.equal(githubRequests.length, 0, "Relay must not call GitHub Issues API");
assert.equal(insertedSubmissions.length, 1, "Accepted submission must be stored in D1");
const submitted = insertedSubmissions[0];
assert.equal(submitted.questions[0].answer, "");
assert.deepEqual(submitted.questions[0].wrongAnswers, ["Self-service password reset"]);
assert.equal(submitted.questions[0].evidenceType, "moodle_review_elimination");

console.log("Review-confirmed elimination sharing relay invariants passed");
