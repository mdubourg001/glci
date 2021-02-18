// @ts-nocheck
// https://docs.gitlab.com/ee/ci/yaml/README.html
// https://github.com/apocas/dockerode
// https://docs.gitlab.com/runner/commands/#gitlab-runner-exec

const yaml = require("js-yaml");
const Docker = require("dockerode");
const git = require("nodegit");
const chalk = require("chalk");
const yargs = require("yargs/yargs");
const dotenv = require("dotenv");
const { hideBin } = require("yargs/helpers");

const path = require("path");
const fs = require("fs");
const { exit } = require("process");

// ----- globals -----

const JOBS_NAMES = [];

const DEFAULT = {};

// ----- constants -----

const ARGV = yargs(hideBin(process.argv)).argv;

const DOTENV_PATH = path.resolve(process.cwd(), ".env");
const ENV = fs.existsSync(DOTENV_PATH)
  ? dotenv.parse(fs.readFileSync(DOTENV_PATH))
  : {};

const LOCAL_CI_DIR = ARGV.dir
  ? path.resolve(process.cwd(), ARGV.dir)
  : path.resolve(process.cwd(), ".local-ci");

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
const GLOBAL_DEFAULT_KEY = [
  "image",
  "before_script",
  "after_script",
  "cache",
  "variables",
];

// ----- main -----

async function execCommands(workdir, container, commands, onerror) {
  for (const command of commands) {
    const exec = await container
      .exec({
        Cmd: ["sh", "-c", command],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: workdir,
      })
      .catch(onerror);

    const stream = await exec.start().catch(onerror);

    container.modem.demuxStream(stream, process.stdout, process.stderr);
    await new Promise((resolve) => stream.on("end", resolve));
  }
}

async function main() {
  if (!fs.existsSync("./.gitlab-ci.yml")) {
    throw "No .gitlab-ci.yml file found in current working directory.";
  }

  const gitlabci = fs.readFileSync("./.gitlab-ci.yml", "utf8");
  let ci = yaml.load(gitlabci);

  if (typeof ci !== "object") {
    throw "Your .gitlab-ci.yml file is invalid.";
  }

  // checking mandatory keys
  if (!("stages" in ci)) {
    throw "No 'stages' keyword found in your .gitlab-ci.yml.";
  }

  const docker = new Docker();
  const repository = await git.Repository.open(".");
  const commit = (await repository.getHeadCommit()).sha().slice(0, 7);

  const master = await repository.getMasterCommit();
  const tree = await master.getTree();
  const walker = tree.walk();
  let project = [];

  // listing .git project files
  walker.on("entry", (entry) => project.push(entry.path()));
  walker.start();

  // handling inclusion of other yaml files
  if ("include" in ci) {
    let included = "";

    for (const entry of ci.include) {
      if ("local" in entry) {
        included += fs.readFileSync(process.cwd() + entry.local) + "\n";
      } else {
        throw "Only 'local' includes are supported at the moment.";
      }
    }

    ci = { ...ci, ...yaml.load(included) };
    //console.log(ci, "\n\n============\n");
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
      const workdir = `/${commit}`;
      const image = job.image ?? DEFAULT.image;
      const variables = { ...ENV, ...DEFAULT.variables, ...job.variables };
      const cache = {
        policy: job.cache?.policy ?? DEFAULT.cache?.policy ?? "pull-push",
        // TODO: handle "untracked"
        // https://git-scm.com/docs/git-ls-files
        paths:
          job.cache?.paths ?? Array.isArray(job.cache)
            ? job.cache
            : Array.isArray(DEFAULT.cache)
            ? DEFAULT.cache
            : DEFAULT.cache?.paths ?? [],
      };

      const onerror = (err) => {
        console.error(chalk.red("✘"), ` - ${name}`);
        console.error(err);
        exit(1);
      };

      // pulling the image to use
      await new Promise((resolve, reject) =>
        docker.pull(image, {}, (err, stream) => {
          if (err) reject(err);
          docker.modem.followProgress(stream, resolve);
        })
      ).catch(onerror);

      const config = {
        Image: image,
        Tty: true,
        Env: Object.keys(variables).map((key) => `${key}=${variables[key]}`),
        HostConfig: {
          AutoRemove: true,
          Binds: [
            // binding project directory files as read-only
            ...project.map(
              (p) => `${path.resolve(process.cwd(), p)}:${workdir}/${p}:ro`
            ),
            // binding cache directories / files
            ...cache.paths.map(
              (p) =>
                `${LOCAL_CI_DIR}/${p}:${workdir}/${p}${
                  cache.policy === "pull" ? ":ro" : ""
                }`
            ),
          ],
        },
      };

      // console.log(config);

      const container = await docker.createContainer(config).catch(onerror);
      await container.start().catch(onerror);

      // running before_script
      if (job.before_script || DEFAULT.before_script) {
        const commands = job.before_script ?? DEFAULT.before_script;

        await execCommands(workdir, container, commands, onerror);
      }

      // running script
      await execCommands(workdir, container, job.script, onerror);

      // running after_script
      if (job.after_script || DEFAULT.after_script) {
        const commands = job.after_script ?? DEFAULT.after_script;

        await execCommands(workdir, container, commands, onerror);
      }

      // stopping and removing container when finishing
      // TODO: do it onerror also
      await container.stop().catch(onerror);
      //await container.remove({ v: true }).catch(onerror);

      console.log(chalk.green("✓"), ` - ${name}`);
    }
  }
}

main();
