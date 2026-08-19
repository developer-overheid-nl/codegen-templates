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

test("a generated app accepts an implementation and emits one safe completion log", { timeout: 120_000 }, () => {
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
    `import { Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ToolsApi } from "../api";
import type { ApiImplementations } from "../app/api-implementations";

@Injectable()
class ToolsService extends ToolsApi {
  getPing(message: string | undefined, _request: FastifyRequest, _reply: FastifyReply): string {
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

  const runner = `const { createApp } = require("./dist/app/index.js");
(async () => {
  const app = await createApp();
  await app.init();
  const response = await app.getHttpAdapter().getInstance().inject({
    method: "GET",
    url: "/ping?message=supersecret",
    headers: { "x-request-id": "req-123" },
  });
  console.log("RESULT " + JSON.stringify({
    statusCode: response.statusCode,
    body: response.body,
    requestId: response.headers["x-request-id"],
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
    statusCode: 200,
    body: "pong:supersecret",
    requestId: "req-123",
  });

  const logs = lines.flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const completions = logs.filter((entry) => entry.event === "http.request.completed");
  assert.equal(completions.length, 1);
  assert.equal(completions[0].requestId, "req-123");
  assert.equal(completions[0].route, "/ping");
  assert.equal(JSON.stringify(completions[0]).includes("supersecret"), false);

  const generatedTsconfig = JSON.parse(readFileSync(join(outputDirectory, "tsconfig.json"), "utf8"));
  assert.equal("baseUrl" in generatedTsconfig.compilerOptions, false);
});
