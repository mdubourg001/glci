// @ts-nocheck

const mockfs = require("mock-fs");
const path = require("path");

const { glci } = require("../");
const { GITLAB_CI_YML } = require("../src/constants");
const { mockfsLoadCWD } = require("./utils");

beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation();
});

afterAll(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  mockfs.restore();
});

describe("Launch", () => {
  test("should fail if no .gitlab-ci.yml exists", async (done) => {
    mockfs({
      ...mockfsLoadCWD((file) => file !== path.basename(GITLAB_CI_YML)),
    });

    jest.spyOn(process, "exit").mockImplementationOnce((code) => {
      expect(code).toBe(1);
      done();
      throw "";
    });

    expect(await glci()).toThrow();
  });

  test("should fail if .gitlab-ci.yml is badly formatted", async (done) => {
    mockfs({
      ...mockfsLoadCWD((file) => file !== path.basename(GITLAB_CI_YML)),
      [path.basename(GITLAB_CI_YML)]: `image\nvariables:\n`,
    });

    jest.spyOn(process, "exit").mockImplementationOnce((code) => {
      expect(code).toBe(1);
      done();
      throw "";
    });

    expect(await glci()).toThrow();
  });
});
