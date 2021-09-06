// @ts-nocheck

const mockfs = require("mock-fs");
const path = require("path");
const { test } = require("uvu");
const assert = require("uvu/assert");

const { glci } = require("../");
const { GITLAB_CI_YML } = require("../src/constants");
const { mockfsLoadCWD } = require("./utils");

test.before.each(() => mockfs.restore());

test("should fail if no .gitlab-ci.yml exists", async () => {
  mockfs({
    ...mockfsLoadCWD((file) => file !== path.basename(GITLAB_CI_YML)),
  });

  console.error = () => {};
  process.exit = () => {};

  try {
    await glci();
    assert.unreachable();
  } catch {}
});

test("should fail if .gitlab-ci.yml is badly formatted", async (done) => {
  mockfs({
    ...mockfsLoadCWD((file) => file !== path.basename(GITLAB_CI_YML)),
    [path.basename(GITLAB_CI_YML)]: `image\nvariables:\n`,
  });

  console.error = () => {};
  process.exit = () => {};

  try {
    await glci();
    assert.unreachable();
  } catch {}
});

test.run();
