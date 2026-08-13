import assert from "node:assert/strict";
import test from "node:test";

import { getClaudeLinkTarget, validateSkillsLock } from "../scripts/skills.mjs";

const validSkill = {
  name: "example-skill",
  repository: "https://github.com/example/skills.git",
  revision: "0123456789abcdef0123456789abcdef01234567",
  sourcePath: "skills/example-skill",
};

test("validates a lock with immutable skill sources", () => {
  assert.doesNotThrow(() => validateSkillsLock({ version: 1, skills: [validSkill] }));
});

test("rejects unsafe source paths", () => {
  assert.throws(
    () => validateSkillsLock({ version: 1, skills: [{ ...validSkill, sourcePath: "../outside" }] }),
    /sourcePath/,
  );
});

test("rejects duplicate skill names", () => {
  assert.throws(
    () => validateSkillsLock({ version: 1, skills: [validSkill, { ...validSkill }] }),
    /Duplicate/,
  );
});

test("builds Claude links to the canonical skill directory", () => {
  assert.equal(getClaudeLinkTarget("example-skill"), "../../.agents/skills/example-skill");
});
