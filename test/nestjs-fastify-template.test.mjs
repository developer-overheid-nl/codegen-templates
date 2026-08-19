import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateDirectory = join(repositoryRoot, "nestjs-fastify");
const fixture = join(repositoryRoot, "test", "fixtures", "ping.openapi.json");

const run = (command, args, cwd, capture = false) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, LOG_LEVEL: "info" },
    stdio: capture ? "pipe" : "inherit",
  });
  assert.equal(result.status, 0, `${command} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  return result;
};

test("a generated app accepts an implementation and emits one safe completion log per request", { timeout: 120_000 }, () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), "nestjs-fastify-template-test-"));

  run(
    "npx",
    [
      "-y",
      "@openapitools/openapi-generator-cli@2.40.1",
      "generate",
      "-i",
      fixture,
      "-g",
      "typescript-nestjs-server",
      "-o",
      outputDirectory,
      "-t",
      templateDirectory,
      "-c",
      join(templateDirectory, "generator-config.yaml"),
      "--additional-properties=npmName=ping-api,npmVersion=1.0.0,nestVersion=11.2.1,rxjsVersion=7.8.2,tsVersion=6.0.3,nodeVersion=22.0.0",
    ],
    repositoryRoot,
  );

  assert.equal(existsSync(join(outputDirectory, "implementation", "index.ts")), true);
  assert.equal(existsSync(join(outputDirectory, "app", "logging.ts")), true);
  copyFileSync(fixture, join(outputDirectory, "api", "openapi.yaml"));

  writeFileSync(
    join(outputDirectory, "implementation", "index.ts"),
    `import { BadRequestException, Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ToolsApi } from "../api";
import type { ApiImplementations } from "../app/api-implementations";

@Injectable()
class ToolsService extends ToolsApi {
  getPing(message: string | undefined, _request: FastifyRequest, _reply: FastifyReply): string {
    if (message === "fail") throw new BadRequestException("ping failed");
    return \`pong:\${message ?? ""}\`;
  }
}

export const apiImplementations: Partial<ApiImplementations> = {
  toolsApi: ToolsService,
};
`,
  );

  run("npm", ["install", "--ignore-scripts"], outputDirectory);
  run("npm", ["run", "typecheck"], outputDirectory);
  run("npm", ["run", "build"], outputDirectory);

  const runner = `process.env.OPENAPI_VALIDATE_RESPONSES = "true";
const { createApp } = require("./dist/app/index.js");
(async () => {
  const app = await createApp();
  await app.init();
  const response = await app.getHttpAdapter().getInstance().inject({
    method: "GET",
    url: "/ping?message=supersecret",
    headers: { "x-request-id": "req-123" },
  });
  const missing = await app.getHttpAdapter().getInstance().inject({
    method: "GET",
    url: "/missing?token=never-reflect-this",
    headers: { "x-request-id": "missing-123" },
  });
  const invalid = await app.getHttpAdapter().getInstance().inject({
    method: "GET",
    url: "/ping?message=",
    headers: { "x-request-id": "invalid-123" },
  });
  const failed = await app.getHttpAdapter().getInstance().inject({
    method: "GET",
    url: "/ping?message=fail",
    headers: { "x-request-id": "failed-123" },
  });
  console.log("RESULT " + JSON.stringify({
    implemented: {
      statusCode: response.statusCode,
      body: response.body,
      requestId: response.headers["x-request-id"],
    },
    missing: {
      statusCode: missing.statusCode,
      body: JSON.parse(missing.body),
      requestId: missing.headers["x-request-id"],
    },
    invalid: {
      statusCode: invalid.statusCode,
      contentType: invalid.headers["content-type"],
      body: JSON.parse(invalid.body),
      requestId: invalid.headers["x-request-id"],
    },
    failed: {
      statusCode: failed.statusCode,
      contentType: failed.headers["content-type"],
      body: JSON.parse(failed.body),
      requestId: failed.headers["x-request-id"],
    },
  }));
  await app.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});`;
  const execution = run("node", ["-e", runner], outputDirectory, true);
  const lines = execution.stdout.split("\n").filter(Boolean);
  const resultLine = lines.find((line) => line.startsWith("RESULT "));
  assert.ok(resultLine);
  assert.deepEqual(JSON.parse(resultLine.slice(7)), {
    implemented: {
      statusCode: 200,
      body: "pong:supersecret",
      requestId: "req-123",
    },
    missing: {
      statusCode: 404,
      body: { title: "Cannot GET /missing", status: 404 },
      requestId: "missing-123",
    },
    invalid: {
      statusCode: 400,
      contentType: "application/problem+json; charset=utf-8",
      body: {
        title: "Request validation failed",
        status: 400,
        errors: [
          {
            in: "query",
            location: "message",
            code: "minLength",
            detail: "must NOT have fewer than 1 characters",
          },
        ],
      },
      requestId: "invalid-123",
    },
    failed: {
      statusCode: 400,
      contentType: "application/problem+json; charset=utf-8",
      body: {
        title: "ping failed",
        status: 400,
      },
      requestId: "failed-123",
    },
  });

  const logs = lines.flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const completions = logs.filter((entry) => entry.event === "http.request.completed");
  assert.equal(completions.length, 4);
  assert.deepEqual(
    completions.map(({ requestId, route }) => ({ requestId, route })),
    [
      { requestId: "req-123", route: "/ping" },
      { requestId: "missing-123", route: "/missing" },
      { requestId: "invalid-123", route: "/ping" },
      { requestId: "failed-123", route: "/ping" },
    ],
  );
  assert.equal(JSON.stringify(completions).includes("supersecret"), false);
  assert.equal(JSON.stringify(completions).includes("never-reflect-this"), false);

  const generatedTsconfig = JSON.parse(readFileSync(join(outputDirectory, "tsconfig.json"), "utf8"));
  assert.equal("baseUrl" in generatedTsconfig.compilerOptions, false);
});
