import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  const generatedTypeScript = readdirSync(outputDirectory, { recursive: true }).filter((file) =>
    String(file).endsWith(".ts"),
  );
  for (const file of generatedTypeScript) {
    assert.doesNotMatch(readFileSync(join(outputDirectory, String(file)), "utf8"), /\/\*\*/);
  }
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
    if (message === "explode") throw new Error("internal-error-secret");
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
const { spawnSync } = require("node:child_process");
const { createConnection, createServer } = require("node:net");
const { createApp } = require("./dist/app/index.js");
(async () => {
  const app = await createApp();
  const fastify = app.getHttpAdapter().getInstance();
  fastify.post("/abort-test", async () => ({ ok: true }));
  await app.listen(0, "127.0.0.1");
  const response = await fastify.inject({
    method: "GET",
    url: "/ping?message=supersecret",
    headers: {
      "x-request-id": "req-123",
      authorization: "Bearer authorization-secret",
      cookie: "session=cookie-secret",
      "x-api-key": "api-key-secret",
    },
  });
  const missing = await fastify.inject({
    method: "GET",
    url: "/missing?token=never-reflect-this",
    headers: { "x-request-id": "missing-123" },
  });
  const invalid = await fastify.inject({
    method: "GET",
    url: "/ping?message=",
    headers: { "x-request-id": "invalid-123" },
  });
  const failed = await fastify.inject({
    method: "GET",
    url: "/ping?message=fail",
    headers: { "x-request-id": "failed-123" },
  });
  const bodySecret = await fastify.inject({
    method: "POST",
    url: "/missing",
    headers: { "x-request-id": "body-123" },
    payload: { secret: "body-secret" },
  });
  const exploded = await fastify.inject({
    method: "GET",
    url: "/ping?message=explode",
    headers: { "x-request-id": "exploded-123" },
  });
  const address = app.getHttpServer().address();
  await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: address.port }, () => {
      socket.write([
        "POST /abort-test HTTP/1.1",
        "Host: 127.0.0.1",
        "Content-Type: application/json",
        "Content-Length: 100",
        "X-Request-ID: aborted-123",
        "",
        '{"secret":"abort-body-secret"',
      ].join("\\r\\n"));
      setTimeout(() => socket.destroy(), 20);
    });
    socket.on("close", resolve);
    socket.on("error", resolve);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
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
    bodySecret: {
      statusCode: bodySecret.statusCode,
      body: JSON.parse(bodySecret.body),
      requestId: bodySecret.headers["x-request-id"],
    },
    exploded: {
      statusCode: exploded.statusCode,
      contentType: exploded.headers["content-type"],
      body: JSON.parse(exploded.body),
      requestId: exploded.headers["x-request-id"],
    },
  }));
  await app.close();
  const blocker = createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", resolve);
  });
  const blockerAddress = blocker.address();
  const startup = spawnSync(process.execPath, ["dist/app/index.js"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(blockerAddress.port), LOG_LEVEL: "silent" },
  });
  await new Promise((resolve) => blocker.close(resolve));
  const startupFailure = startup.stderr
    .split("\\n")
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    })
    .find((entry) => entry.event === "application.startup.failed");
  console.log("STARTUP " + JSON.stringify({ status: startup.status, failure: startupFailure }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});`;
  const execution = run("node", ["-e", runner], outputDirectory, true);
  const lines = execution.stdout.split("\n").filter(Boolean);
  const resultLine = lines.find((line) => line.startsWith("RESULT "));
  const startupLine = lines.find((line) => line.startsWith("STARTUP "));
  assert.ok(resultLine);
  assert.ok(startupLine);
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
    bodySecret: {
      statusCode: 404,
      body: { title: "Cannot POST /missing", status: 404 },
      requestId: "body-123",
    },
    exploded: {
      statusCode: 500,
      contentType: "application/problem+json; charset=utf-8",
      body: {
        title: "Internal Server Error",
        status: 500,
      },
      requestId: "exploded-123",
    },
  });
  assert.deepEqual(JSON.parse(startupLine.slice(8)), {
    status: 1,
    failure: {
      event: "application.startup.failed",
      errorName: "Error",
      errorCode: "EADDRINUSE",
    },
  });

  const logs = lines.flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const completions = logs.filter((entry) =>
    ["http.request.completed", "http.request.aborted"].includes(entry.event),
  );
  assert.equal(completions.length, 7);
  assert.deepEqual(
    completions.map(({ event, level, requestId, route, statusCode }) => ({
      event,
      level,
      requestId,
      route,
      statusCode,
    })),
    [
      { event: "http.request.completed", level: 30, requestId: "req-123", route: "/ping", statusCode: 200 },
      { event: "http.request.completed", level: 40, requestId: "missing-123", route: "/missing", statusCode: 404 },
      { event: "http.request.completed", level: 40, requestId: "invalid-123", route: "/ping", statusCode: 400 },
      { event: "http.request.completed", level: 40, requestId: "failed-123", route: "/ping", statusCode: 400 },
      { event: "http.request.completed", level: 40, requestId: "body-123", route: "/missing", statusCode: 404 },
      { event: "http.request.completed", level: 50, requestId: "exploded-123", route: "/ping", statusCode: 500 },
      { event: "http.request.aborted", level: 40, requestId: "aborted-123", route: "/abort-test", statusCode: 499 },
    ],
  );
  const serializedCompletions = JSON.stringify(completions);
  for (const secret of [
    "supersecret",
    "never-reflect-this",
    "authorization-secret",
    "cookie-secret",
    "api-key-secret",
    "body-secret",
    "internal-error-secret",
    "abort-body-secret",
  ]) {
    assert.equal(serializedCompletions.includes(secret), false);
  }

  const generatedTsconfig = JSON.parse(readFileSync(join(outputDirectory, "tsconfig.json"), "utf8"));
  assert.equal("baseUrl" in generatedTsconfig.compilerOptions, false);
});
