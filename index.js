// @ts-nocheck
// https://docs.gitlab.com/ee/ci/yaml/README.html
// https://github.com/apocas/dockerode
// https://docs.gitlab.com/runner/commands/#gitlab-runner-exec

const yaml = require("js-yaml");
const Docker = require("dockerode");
const chalk = require("chalk");

const fs = require("fs");

// ----- globals -----

const JOBS_NAMES = [];

const DEFAULT = {};

// ----- constants -----

// keys unusable as job name because reserved
const RESERVED_JOB_NAMES = [
  "image",
  "services",
  "stages",
  "types",
  "before_script",
  "after_script",
  "variables",
  "cache",
  "include",
];

// keys that can appear in "default" key
// https://docs.gitlab.com/ee/ci/yaml/README.html#global-defaults
const GLOBAL_DEFAULT_KEY = ["image", "before_script", "after_script"];

// ----- main -----

async function main() {
  const gitlabci = fs.readFileSync("./.gitlab-ci.yml", "utf8");
  let ci = yaml.load(gitlabci);

  if (typeof ci !== "object") {
    throw "Your .gitlab-ci.yml file is invalid.";
  }

  // checking mandatory keys
  if (!("stages" in ci)) {
    throw "No 'stages' keyword found in your .gitlab-ci.yml.";
  }

  // handling inclusion of other yaml files
  if ("include" in ci) {
    let included = "";

    for (const entry of ci.include) {
      if ("local" in entry) {
        included += fs.readFileSync(__dirname + entry.local) + "\n";
      } else {
        throw "Only 'local' includes are supported at the moment.";
      }
    }

    ci = { ...ci, ...yaml.load(included) };
    console.log(ci, "\n\n============\n");
  }

  // figuring out default values
  for (const key of GLOBAL_DEFAULT_KEY) {
    DEFAULT[key] = ci.default ? ci.default[key] : ci[key];
  }

  // diff. actual jobs from reserved "config" keys
  for (const key of Object.keys(ci)) {
    if (!RESERVED_JOB_NAMES.includes(key)) {
      JOBS_NAMES.push(key);
    }
  }

  // running stages by order of definition in the "stages" key
  for (const stage of ci.stages) {
    const jobs = JOBS_NAMES.filter((j) => (ci[j].stage ?? "test") === stage);

    // as default value for a job is "test"
    // see https://docs.gitlab.com/ee/ci/yaml/README.html#stages
    for (const name of jobs) {
      const job = ci[name];
      const docker = new Docker();

      const onerror = (err) => {
        console.error(chalk.red("✘"), ` - ${name}`);
        console.error(err);
      };

      // TODO: use config defined in job
      const container = await docker
        .createContainer({
          Image: "alpine:edge",
          Cmd: ["/bin/ash"],
          Tty: true,
        })
        .catch(onerror);

      await container.start().catch(onerror);

      const attach = await container
        .attach({
          stream: true,
          stdout: true,
          stderr: true,
        })
        .catch(onerror);

      // TODO: handle writing to log files
      attach.pipe(process.stdout);

      const exec = await container
        .exec({
          Cmd: ["echo", "Hello from Dockerode !"],
          AttachStdout: true,
          AttachStderr: true,
        })
        .catch(onerror);
      const stream = await exec.start().catch(onerror);

      // TODO: handle writing to log files
      container.modem.demuxStream(stream, process.stdout, process.stderr);

      await container.stop().catch(onerror);
      await container.remove().catch(onerror);

      console.log(chalk.green("✓"), ` - ${name}`);
    }
  }
}

main();
