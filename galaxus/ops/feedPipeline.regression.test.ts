import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the Aug 2026 outage: dynamic-import of the Next upload route pulled
 * `server-only` into a bad boundary and killed every Galaxus feed push.
 */
describe("feedPipeline upload path regression", () => {
  const pipelineSrc = fs.readFileSync(
    path.join(process.cwd(), "galaxus/ops/feedPipeline.ts"),
    "utf8"
  );
  const uploadRouteSrc = fs.readFileSync(
    path.join(process.cwd(), "app/api/galaxus/feeds/upload/route.ts"),
    "utf8"
  );

  it("never dynamic-imports the Next upload route", () => {
    expect(pipelineSrc).not.toMatch(/import\(["']@\/app\/api\/galaxus\/feeds\/upload/);
    expect(pipelineSrc).not.toMatch(/from ["']@\/app\/api\/galaxus\/feeds\/upload/);
  });

  it("calls runFeedUpload from the server-only ops module", () => {
    expect(pipelineSrc).toMatch(/from ["']@\/galaxus\/ops\/runFeedUpload["']/);
    expect(pipelineSrc).toMatch(/runFeedUpload\(/);
  });

  it("marks failed triggers FAILED (no fail→PENDING retry loop)", () => {
    expect(pipelineSrc).toMatch(/status: params\.success \? "DONE" : "FAILED"/);
    expect(pipelineSrc).not.toMatch(/status: params\.success \? "DONE" : "PENDING"/);
  });

  it("upload HTTP route is a thin wrapper over runFeedUpload", () => {
    expect(uploadRouteSrc).toMatch(/runFeedUpload/);
    expect(uploadRouteSrc).toMatch(/parseFeedUploadRequest/);
    expect(uploadRouteSrc.length).toBeLessThan(800);
  });
});
