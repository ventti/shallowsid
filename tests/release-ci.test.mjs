import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
function fixture(t, subject) {
  const dir = mkdtempSync(join(tmpdir(), "shallowsid-release-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  cpSync(new URL(".release-scripts", root), join(dir, ".release-scripts"), { recursive: true });
  mkdirSync(join(dir, "tools"));
  cpSync(new URL("tools/prepare_release.sh", root), join(dir, "tools/prepare_release.sh"));
  writeFileSync(join(dir, ".release.env"), "RELEASE_BRANCH_PATTERN='main'\nRELEASE_CHECK_COMMAND='true'\nRELEASE_CHANGELOG_THRESHOLD='minor'\nRELEASE_GITHUB_THRESHOLD='patch'\n");
  git("add", ".");
  git("commit", "-m", "chore: initialize");
  git("tag", "v1.2.3");
  writeFileSync(join(dir, "change"), subject);
  git("add", ".");
  git("commit", "-m", subject);
  const before = git("rev-parse", "HEAD");
  const output = join(dir, ".git", "outputs");
  const state = join(dir, ".git", "release-state");
  const run = () => {
    writeFileSync(output, "");
    execFileSync("bash", ["tools/prepare_release.sh", state], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: output }, stdio: "pipe" });
    return readFileSync(output, "utf8");
  };
  return { dir, git, before, state, run };
}

for (const [subject, version, full] of [["fix: repair playback", "v1.2.4", false], ["feat: add playback mode", "v1.3.0", true], ["fix!: replace playback interface", "v2.0.0", true], ["docs: clarify controls", "v1.2.4", false]]) {
  test(`production release: ${subject}`, (t) => {
    const { dir, git, before, state, run } = fixture(t, subject);
    assert.equal(run(), `tag=${version}\n`);
    const head = git("rev-parse", "HEAD");
    assert.equal(head !== before, full);
    assert.equal(existsSync(join(dir, "CHANGELOG.md")), full);
    assert.equal(git("rev-parse", `${version}^{}`), head);
    assert.ok(readFileSync(join(state, "notes.md"), "utf8").includes(subject.replace(/^[^:]+: /, "")));
    git("bundle", "verify", join(state, "release.bundle"));
    // The publishing job starts at the original pushed commit, then restores the bundle.
    git("checkout", "--detach", before);
    git("fetch", join(state, "release.bundle"), "refs/heads/main:refs/heads/ci-release", `refs/tags/${version}:refs/tags/${version}`);
    git("checkout", "-B", "main", "ci-release");
    assert.equal(git("rev-parse", "HEAD"), head);
    assert.equal(run(), "", "rerunning a released commit must not create another version");
  });
}

test("failed release checks leave no tag or release bundle", (t) => {
  const { dir, git, state, run } = fixture(t, "fix: repair playback");
  writeFileSync(join(dir, ".release.env"), "RELEASE_BRANCH_PATTERN='main'\nRELEASE_CHECK_COMMAND='false'\n");
  git("add", ".release.env");
  git("commit", "-m", "ci: fail the check");
  assert.throws(run);
  assert.equal(git("tag", "--list"), "v1.2.3");
  assert.equal(existsSync(join(state, "release.bundle")), false);
});
