const git = require("nodegit");

// https://docs.gitlab.com/ee/ci/variables/predefined_variables.html
module.exports = async (job) => {
  const repository = await git.Repository.open(".");
  const branch = await repository.getCurrentBranch();
  const headCommit = await repository.getHeadCommit();

  const branchName = branch.name().replace("refs/heads/", "");

  return {
    CI: true,
    CI_API_V4_URL: "https://gitlab.example.com/api/v4/",
    CI_BUILDS_DIR: "/",
    CI_COMMIT_BEFORE_SHA: "0000000000000000000000000000000000000000",
    CI_COMMIT_DESCRIPTION:
      headCommit.message().split("\n")[0].length < 100
        ? headCommit.message().split("\n").slice(1).join("\n")
        : headCommit.message(),
    CI_COMMIT_MESSAGE: headCommit.message(),
    CI_COMMIT_REF_NAME: branchName,
    CI_COMMIT_REF_PROTECTED: false,
    CI_COMMIT_REF_SLUG: branchName
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\-]+/g, "")
      .replace(/\-\-+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, ""),
    CI_COMMIT_SHA: headCommit.sha(),
    CI_COMMIT_SHORT_SHA: headCommit.sha().slice(0, 8),
    CI_COMMIT_BRANCH: branchName,
    CI_COMMIT_TITLE: headCommit.message().split("\n")[0],
    CI_COMMIT_TIMESTAMP: headCommit.time(),
    CI_CONCURRENT_ID: "42",
    CI_CONCURRENT_PROJECT_ID: "42",
    CI_CONFIG_PATH: ".gitlab-ci.yml",
    CI_DEBUG_TRACE: false,
    // TODO: figure it out
    CI_DEFAULT_BRANCH: "master",
    CI_JOB_ID: "42",
    CI_JOB_IMAGE: job.image,
    CI_JOB_MANUAL: false,
    CI_JOB_NAME: job.name,
    CI_JOB_STAGE: job.stage ?? "test",
    CI_NODE_INDEX: job.index,
    CI_NODE_TOTAL: 1,
    CI_PIPELINE_ID: 42,
    CI_PIPELINE_IID: 42,
    CI_PIPELINE_SOURCE: "unknown",
    CI_PIPELINE_TRIGGERED: true,
    CI_PROJECT_DIR: job.workdir,
    CI_PROJECT_ID: 42,
    CI_PROJECT_NAME: "glci-name-stub",
    CI_PROJECT_NAMESPACE: "glci-namespace-stub",
    CI_PROJECT_ROOT_NAMESPACE: "glci-root-namespace-stub",
    CI_PROJECT_PATH: "glci-namespace-stub/glci-name-stub",
    CI_PROJECT_PATH_SLUG: "glci-namespace-stub-glci-name-stub",
    CI_PROJECT_REPOSITORY_LANGUAGES: "",
    CI_PROJECT_TITLE: "Local CI Title Stub",
    CI_PROJECT_VISIBILITY: "internal",
    CI_RUNNER_DESCRIPTION: "Local CI Runner",
    CI_RUNNER_ID: 42,
    CI_RUNNER_REVISION: "42.42.42",
    CI_RUNNER_SHORT_TOKEN: "42424242",
    CI_RUNNER_VERSION: "42.42.42",
    CI_SERVER: true,
    CI_SERVER_NAME: "Local CI",
    CI_SERVER_REVISION: "42.42.42",
    CI_SERVER_VERSION: "42.42.42",
    CI_SERVER_VERSION_MAJOR: 42,
    CI_SERVER_VERSION_MINOR: 42,
    CI_SERVER_VERSION_PATCH: 42,
    GITLAB_CI: true,
    GITLAB_USER_EMAIL: "gitlab@glci.com",
    GITLAB_USER_ID: 42,
  };
};
