import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseSemver,
  compareSemver,
  validateVersionArg,
  rewriteVersionInJson,
  rewriteVersionInCargoToml,
  rewriteVersionInCargoLock,
  findUnreleasedBlock,
  validateChangelogUnreleased,
  rewriteChangelog,
  isGitClean,
  tagExistsLocally,
} from "./bump-version.mjs";

describe("parseSemver", () => {
  it("parses major.minor.patch", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
  });

  it("parses pre-release identifiers", () => {
    expect(parseSemver("0.2.0-rc.1")).toEqual({
      major: 0,
      minor: 2,
      patch: 0,
      pre: ["rc", "1"],
    });
  });

  it("rejects invalid strings", () => {
    expect(parseSemver("v1.2.3")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("1.2.3.4")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });
});

describe("compareSemver", () => {
  it("compares numerically", () => {
    expect(compareSemver("0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareSemver("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
  });

  it("treats no-prerelease > prerelease", () => {
    expect(compareSemver("0.2.0", "0.2.0-rc.1")).toBeGreaterThan(0);
    expect(compareSemver("0.2.0-rc.1", "0.2.0")).toBeLessThan(0);
  });

  it("orders prerelease identifiers numerically when both numeric", () => {
    expect(compareSemver("0.2.0-rc.2", "0.2.0-rc.1")).toBeGreaterThan(0);
  });
});

describe("validateVersionArg", () => {
  it("accepts a strictly greater version", () => {
    expect(() => validateVersionArg("0.2.0", "0.1.0")).not.toThrow();
  });

  it("rejects missing argument", () => {
    expect(() => validateVersionArg(undefined, "0.1.0")).toThrow(/Missing/);
  });

  it("rejects invalid semver", () => {
    expect(() => validateVersionArg("v0.2.0", "0.1.0")).toThrow(/valid semver/);
    expect(() => validateVersionArg("0.2", "0.1.0")).toThrow(/valid semver/);
  });

  it("rejects same version", () => {
    expect(() => validateVersionArg("0.1.0", "0.1.0")).toThrow(/strictly greater/);
  });

  it("rejects downgrade", () => {
    expect(() => validateVersionArg("0.0.9", "0.1.0")).toThrow(/strictly greater/);
  });
});

describe("rewriteVersionInJson", () => {
  it("updates the top-level version field", () => {
    const input = '{\n  "name": "x",\n  "version": "0.1.0",\n  "x": 1\n}';
    const out = rewriteVersionInJson(input, "0.2.0");
    expect(out).toContain('"version": "0.2.0"');
    expect(out).toContain('"name": "x"');
    expect(JSON.parse(out).version).toBe("0.2.0");
  });

  it("throws when no version field exists", () => {
    expect(() => rewriteVersionInJson('{"x": 1}', "0.2.0")).toThrow();
  });
});

describe("rewriteVersionInCargoToml", () => {
  it("updates the [package] version line", () => {
    const input = '[package]\nname = "x"\nversion = "0.1.0"\nedition = "2021"\n';
    const out = rewriteVersionInCargoToml(input, "0.2.0");
    expect(out).toContain('version = "0.2.0"');
  });
});

describe("rewriteVersionInCargoLock", () => {
  it("updates only the named package", () => {
    const input = [
      '[[package]]',
      'name = "other-crate"',
      'version = "1.0.0"',
      '',
      '[[package]]',
      'name = "modbus-workbench"',
      'version = "0.1.0"',
      'dependencies = []',
      '',
    ].join("\n");
    const out = rewriteVersionInCargoLock(input, "0.2.0", "modbus-workbench");
    expect(out).toContain('name = "modbus-workbench"\nversion = "0.2.0"');
    expect(out).toContain('name = "other-crate"\nversion = "1.0.0"');
  });

  it("throws when the package is missing", () => {
    expect(() =>
      rewriteVersionInCargoLock("", "0.2.0", "modbus-workbench"),
    ).toThrow();
  });
});

describe("findUnreleasedBlock", () => {
  it("extracts body between Unreleased and next heading", () => {
    const md = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "- New thing",
      "",
      "## [0.1.0] - 2025-01-01",
      "",
      "- Initial",
    ].join("\n");
    const block = findUnreleasedBlock(md);
    expect(block).not.toBeNull();
    expect(block.body).toContain("- New thing");
    expect(block.body).not.toContain("0.1.0");
  });

  it("returns null when Unreleased is missing", () => {
    expect(findUnreleasedBlock("# Changelog\n\n## [0.1.0]\n")).toBeNull();
  });
});

describe("validateChangelogUnreleased", () => {
  it("accepts non-empty Unreleased", () => {
    const md = "# Changelog\n\n## [Unreleased]\n\n- Real entry\n";
    expect(() => validateChangelogUnreleased(md)).not.toThrow();
  });

  it("rejects missing Unreleased", () => {
    expect(() => validateChangelogUnreleased("# Changelog\n")).toThrow(/missing/);
  });

  it("rejects empty Unreleased", () => {
    const md = "# Changelog\n\n## [Unreleased]\n\n\n## [0.1.0]\n";
    expect(() => validateChangelogUnreleased(md)).toThrow(/empty/);
  });

  it("rejects whitespace-only Unreleased", () => {
    const md = "# Changelog\n\n## [Unreleased]\n   \n\t\n";
    expect(() => validateChangelogUnreleased(md)).toThrow(/empty/);
  });
});

describe("rewriteChangelog", () => {
  it("renames Unreleased to the dated version and inserts a fresh Unreleased above", () => {
    const md = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "- New thing",
      "",
      "## [0.1.0] - 2025-01-01",
      "",
      "- Initial",
      "",
    ].join("\n");
    const out = rewriteChangelog(md, "0.2.0", "2026-05-19");
    expect(out).toMatch(/## \[Unreleased\]\s*\n\s*\n_No changes yet\._/);
    expect(out).toContain("## [0.2.0] - 2026-05-19");
    expect(out).toContain("- New thing");
    expect(out).toContain("## [0.1.0] - 2025-01-01");
    // Unreleased heading appears exactly once, above the dated version
    const unreleasedIdx = out.indexOf("## [Unreleased]");
    const datedIdx = out.indexOf("## [0.2.0]");
    expect(unreleasedIdx).toBeGreaterThanOrEqual(0);
    expect(datedIdx).toBeGreaterThan(unreleasedIdx);
    expect(out.indexOf("## [Unreleased]", unreleasedIdx + 1)).toBe(-1);
  });
});

describe("git-state checks (temporary repo)", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bump-version-test-"));
    execSync("git init -q", { cwd: tmpDir });
    execSync('git config user.email "inowio@outlook.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
    execSync("git config commit.gpgsign false", { cwd: tmpDir });
    writeFileSync(join(tmpDir, "seed.txt"), "seed\n");
    execSync("git add seed.txt", { cwd: tmpDir });
    execSync('git commit -q -m "seed"', { cwd: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports a clean tree as clean", () => {
    expect(isGitClean(tmpDir)).toBe(true);
  });

  it("reports an untracked file as dirty", () => {
    writeFileSync(join(tmpDir, "dirty.txt"), "x\n");
    expect(isGitClean(tmpDir)).toBe(false);
  });

  it("detects an existing local tag", () => {
    expect(tagExistsLocally(tmpDir, "v0.2.0")).toBe(false);
    execSync("git tag v0.2.0", { cwd: tmpDir });
    expect(tagExistsLocally(tmpDir, "v0.2.0")).toBe(true);
    expect(tagExistsLocally(tmpDir, "v0.3.0")).toBe(false);
  });
});
