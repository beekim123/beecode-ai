import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const skillsDirectory = join(projectRoot, ".agents", "skills");
const claudeSkillsDirectory = join(projectRoot, ".claude", "skills");
const lockFile = join(skillsDirectory, "skills.lock.json");
const indexFile = join(skillsDirectory, "INDEX.md");
const skillNamePattern = /^[a-z0-9][a-z0-9-]*$/;
const revisionPattern = /^[0-9a-f]{40,64}$/;

function assertSkillName(name) {
  if (typeof name !== "string" || !skillNamePattern.test(name)) {
    throw new Error(`Invalid skill name: ${String(name)}`);
  }
}

function assertSourcePath(sourcePath) {
  if (
    typeof sourcePath !== "string" ||
    sourcePath.length === 0 ||
    isAbsolute(sourcePath) ||
    sourcePath.split(/[\\/]/).some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Invalid skill sourcePath: ${String(sourcePath)}`);
  }
}

export function validateSkillsLock(lock) {
  if (typeof lock !== "object" || lock === null || lock.version !== 1 || !Array.isArray(lock.skills)) {
    throw new Error("skills.lock.json must contain version 1 and a skills array.");
  }

  const names = new Set();
  for (const skill of lock.skills) {
    if (typeof skill !== "object" || skill === null) {
      throw new Error("Each locked skill must be an object.");
    }

    assertSkillName(skill.name);
    assertSourcePath(skill.sourcePath);

    if (typeof skill.repository !== "string" || !/^https?:\/\/|^ssh:\/\/|^git@/.test(skill.repository)) {
      throw new Error(`Invalid repository for ${skill.name}.`);
    }

    if (typeof skill.revision !== "string" || !revisionPattern.test(skill.revision)) {
      throw new Error(`Invalid immutable revision for ${skill.name}.`);
    }

    if (names.has(skill.name)) {
      throw new Error(`Duplicate locked skill: ${skill.name}.`);
    }
    names.add(skill.name);
  }

  return lock;
}

export function getClaudeLinkTarget(name) {
  assertSkillName(name);
  return relative(claudeSkillsDirectory, join(skillsDirectory, name));
}

function readSkillsLock() {
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockFile, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${relative(projectRoot, lockFile)}.`, { cause: error });
  }
  return validateSkillsLock(lock);
}

function getSkillDirectory(name) {
  assertSkillName(name);
  return join(skillsDirectory, name);
}

function hasSkillFile(directory) {
  return existsSync(directory) && existsSync(join(directory, "SKILL.md"));
}

function getInstalledSkillNames() {
  return readdirSync(skillsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && hasSkillFile(join(skillsDirectory, entry.name)))
    .map((entry) => entry.name)
    .sort();
}

function getSkillMetadataName(skillDirectory) {
  const content = readFileSync(join(skillDirectory, "SKILL.md"), "utf8");
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const match = frontmatter?.[1].match(/^name:\s*["']?([^"'\s]+)["']?\s*$/m);
  return match?.[1];
}

function runGit(args, workingDirectory = projectRoot) {
  const result = spawnSync("git", args, {
    cwd: workingDirectory,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.error) {
    throw new Error(`Unable to run git ${args[0]}.`, { cause: result.error });
  }
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    throw new Error(`git ${args.join(" ")} failed.${output ? `\n${output}` : ""}`);
  }

  return result.stdout.trim();
}

function installLockedSkill(skill, force) {
  const targetDirectory = getSkillDirectory(skill.name);
  if (hasSkillFile(targetDirectory) && !force) {
    console.log(`Skipped ${skill.name}; it is already installed.`);
    return;
  }

  const repositoryDirectory = mkdtempSync(join(tmpdir(), "beecode-skill-source-"));
  const stagingDirectory = mkdtempSync(join(skillsDirectory, `.${skill.name}-`));

  try {
    runGit(["init", "--quiet", repositoryDirectory]);
    runGit(["-C", repositoryDirectory, "remote", "add", "origin", skill.repository]);
    runGit(["-C", repositoryDirectory, "fetch", "--depth=1", "origin", skill.revision]);

    const fetchedRevision = runGit(["-C", repositoryDirectory, "rev-parse", "FETCH_HEAD"]);
    if (fetchedRevision !== skill.revision) {
      throw new Error(`Fetched revision for ${skill.name} does not match its lock entry.`);
    }

    runGit(["-C", repositoryDirectory, "checkout", "--detach", "--quiet", "FETCH_HEAD"]);

    const sourceDirectory = resolve(repositoryDirectory, skill.sourcePath);
    if (!sourceDirectory.startsWith(`${repositoryDirectory}/`) || !hasSkillFile(sourceDirectory)) {
      throw new Error(`Locked source for ${skill.name} does not contain SKILL.md.`);
    }

    const stagedSkillDirectory = join(stagingDirectory, skill.name);
    cpSync(sourceDirectory, stagedSkillDirectory, { recursive: true });

    if (existsSync(targetDirectory)) {
      rmSync(targetDirectory, { recursive: true, force: true });
    }
    renameSync(stagedSkillDirectory, targetDirectory);
    console.log(`Installed ${skill.name}.`);
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
}

function syncClaudeSkills(force) {
  mkdirSync(claudeSkillsDirectory, { recursive: true });

  for (const name of getInstalledSkillNames()) {
    const linkPath = join(claudeSkillsDirectory, name);
    const expectedTarget = getClaudeLinkTarget(name);

    if (existsSync(linkPath)) {
      const existing = lstatSync(linkPath);
      if (existing.isSymbolicLink() && readlinkSync(linkPath) === expectedTarget) {
        continue;
      }
      if (!force) {
        throw new Error(`Refusing to replace ${relative(projectRoot, linkPath)} without --force.`);
      }
      rmSync(linkPath, { recursive: existing.isDirectory() && !existing.isSymbolicLink(), force: true });
    }

    symlinkSync(expectedTarget, linkPath, "dir");
    console.log(`Linked Claude skill ${name}.`);
  }
}

function checkSkills() {
  const lock = readSkillsLock();
  const errors = [];
  const index = readFileSync(indexFile, "utf8");
  const installedNames = getInstalledSkillNames();

  for (const skill of lock.skills) {
    if (!installedNames.includes(skill.name)) {
      errors.push(`${skill.name} is missing; run pnpm skills:install.`);
    }
  }

  for (const name of installedNames) {
    const skillDirectory = getSkillDirectory(name);
    if (getSkillMetadataName(skillDirectory) !== name) {
      errors.push(`${name} does not declare the matching name in SKILL.md.`);
    }
    if (!index.includes(`\`${name}\``)) {
      errors.push(`${name} is missing from .agents/skills/INDEX.md.`);
    }

    const linkPath = join(claudeSkillsDirectory, name);
    if (!existsSync(linkPath)) {
      errors.push(`Claude link for ${name} is missing; run pnpm skills:sync.`);
      continue;
    }

    const expectedTarget = getClaudeLinkTarget(name);
    const link = lstatSync(linkPath);
    if (!link.isSymbolicLink() || readlinkSync(linkPath) !== expectedTarget) {
      errors.push(`Claude link for ${name} does not point to the canonical project skill.`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.map((error) => `- ${error}`).join("\n"));
  }
  console.log(`Skill check passed for ${installedNames.length} skills.`);
}

function printUsage() {
  console.log("Usage: node scripts/skills.mjs <install|sync|check> [--force]");
}

function main(argumentsList) {
  const [command, ...options] = argumentsList;
  const force = options.includes("--force");
  if (options.some((option) => option !== "--force")) {
    throw new Error("Only --force is supported.");
  }

  switch (command) {
    case "install": {
      const lock = readSkillsLock();
      for (const skill of lock.skills) {
        installLockedSkill(skill, force);
      }
      syncClaudeSkills(force);
      return;
    }
    case "sync":
      readSkillsLock();
      syncClaudeSkills(force);
      return;
    case "check":
      readSkillsLock();
      checkSkills();
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

const executedFile = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedFile === resolve(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
