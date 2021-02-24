#!/usr/bin/env node

const yaml = require("js-yaml");
const Docker = require("dockerode");
const git = require("nodegit");
const chalk = require("chalk");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const dotenv = require("dotenv");

const path = require("path");
const fs = require("fs");
const { performance } = require("perf_hooks");

const define = require("./pre-defined");

// ----- globals -----

const JOBS_NAMES = [];

const DEFAULT = {};

const ARTIFACTS = [];

// ----- constants -----

const ARGV = yargs(hideBin(process.argv)).argv;

const ONLY_JOBS = ARGV["only-jobs"]?.split
  ? ARGV["only-jobs"].split(",")
  : undefined;

const DOTENV_PATH = path.resolve(process.cwd(), ".env");
const ENV = fs.existsSync(DOTENV_PATH)
  ? dotenv.parse(fs.readFileSync(DOTENV_PATH))
  : {};

const LOCAL_CI_DIR = ARGV.dir
  ? path.resolve(process.cwd(), ARGV.dir)
  : path.resolve(process.cwd(), ".glci");

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
    console.log(chalk.bold(chalk.green(command)));
    let exec = null;
    let stream = null;

    try {
      exec = await container.exec({
        Cmd: ["sh", "-c", command],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: workdir,
      });

      stream = await exec.start();
    } catch (err) {
      await onerror(err, container);
    }

    await new Promise((resolve, reject) => {
      stream.on("end", async () => {
        const inspect = await exec.inspect();

        if (inspect.ExitCode !== 0) reject();
        resolve();
      });
      container.modem.demuxStream(stream, process.stdout, {
        write: (err) => console.error(chalk.red(err.toString())),
      });
    });
  }
}

async function main() {
  if (!fs.existsSync(path.resolve(process.cwd(), ".gitlab-ci.yml"))) {
    throw "No .gitlab-ci.yml file found in current working directory.";
  }

  const gitlabci = fs.readFileSync(
    path.resolve(process.cwd(), ".gitlab-ci.yml"),
    "utf8"
  );
  let ci = yaml.load(gitlabci);

  if (typeof ci !== "object") {
    throw "Your .gitlab-ci.yml file is invalid.";
  }

  // checking mandatory keys
  if (!("stages" in ci)) {
    throw "No 'stages' keyword found in your .gitlab-ci.yml.";
  }

  //const docker = new Docker();

  // hacky way to do docker over ssh
  // const agent = ssh({
  //   host: "127.0.0.1",
  //   port: 2222,
  //   username: "vagrant",
  //   privateKey: fs.readFileSync(
  //     "/Users/maxime.dubourg/.vagrant.d/insecure_private_key"
  //   ),
  // });

  // const docker = new Docker({
  //   protocol: "http",
  //   username: "vagrant",
  //   agent,
  // });

  const docker = new Docker();

  try {
    await docker.version();
  } catch (err) {
    console.error(chalk.red(err));
    console.error("Docker daemon does not seem to be running.");
    process.exit(1);
  }

  const repository = await git.Repository.open(".");
  const commit = await repository.getHeadCommit();
  const sha = commit.sha().slice(0, 7);

  const tree = await commit.getTree();
  const walker = tree.walk();
  let projectFiles = [];

  // listing .git project files
  walker.on("entry", (entry) => projectFiles.push(entry.path()));
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
    const jobs = JOBS_NAMES.filter(
      (job) => (ci[job].stage ?? "test") === stage
    ).filter((job) => (ONLY_JOBS ? ONLY_JOBS.includes(job) : true));

    let index = 0;

    // as default value for a job is "test"
    // see https://docs.gitlab.com/ee/ci/yaml/README.html#stages
    for (const name of jobs) {
      index++;

      const now = performance.now();
      const job = ci[name];

      // pushing artifacts paths in global artifacts
      if ("artifacts" in job) {
        if ("paths" in job.artifacts) {
          for (const file of job.artifacts.paths) {
            if (!ARTIFACTS.includes(file)) {
              ARTIFACTS.push(file);
            }
          }
        }
      }

      const workdir = `/${sha}`;
      const image = job.image ?? DEFAULT.image;
      const cache = {
        policy: job.cache?.policy ?? DEFAULT.cache?.policy ?? "pull-push",
        paths:
          job.cache?.paths ?? Array.isArray(job.cache)
            ? job.cache
            : Array.isArray(DEFAULT.cache)
            ? DEFAULT.cache
            : DEFAULT.cache?.paths ?? [],
      };

      let artifactsFiles = ARTIFACTS;

      // filtering to bind artifacts from specified jobs only
      if (job.dependencies) {
        artifactsFiles = ARTIFACTS.filter((file) =>
          job.dependencies.some((jobName) =>
            ci[jobName].artifacts?.paths?.includes(file)
          )
        );
      }

      // filtering artifacts files against cache files
      artifactsFiles = artifactsFiles.filter(
        (file) => !cache.paths.includes(file)
      );

      const preDefined = await define({
        ...job,
        name,
        index,
        image,
        workdir,
      });
      const variables = {
        ...preDefined,
        ...ENV,
        ...DEFAULT.variables,
        ...job.variables,
      };

      const headline = `Running job "${chalk.yellow(name)}" for stage "${
        job.stage ?? "test"
      }"`;
      const delimiter = new Array(headline.length).fill("-").join("");
      console.log(chalk.bold(delimiter));
      console.log(chalk.bold(headline));
      console.log(chalk.bold(delimiter + "\n"));

      const onerror = async (err, container) => {
        if (err) console.error(chalk.red(err));
        console.error(chalk.red("✘"), ` - ${name}\n`);

        if (container) await container.stop();
        process.exit(1);
      };

      try {
        // pulling the image to use
        await new Promise((resolve, reject) =>
          docker.pull(image, {}, (err, stream) => {
            if (err) reject(err);

            let downloading = false;
            docker.modem.followProgress(
              stream,
              () => {
                if (!downloading) {
                  console.log(
                    chalk.bold(
                      `${chalk.blue("ℹ")} - Using existing image "${image}"`
                    )
                  );
                }

                resolve();
              },
              (progress) => {
                if (!downloading && progress.status === "Downloading") {
                  downloading = true;
                  console.log(
                    chalk.bold(
                      `${chalk.blue("ℹ")} - Pulling image "${image}"...`
                    )
                  );
                }
              }
            );
          })
        );
      } catch (err) {
        await onerror(err);
      }

      const config = {
        Image: image,
        Tty: true,
        Env: Object.keys(variables).map((key) => `${key}=${variables[key]}`),
        HostConfig: {
          AutoRemove: true,
          Binds: [
            // binding project directory files as read-only
            ...projectFiles.map(
              (p) => `${path.resolve(process.cwd(), p)}:${workdir}/${p}:ro`
            ),
            // binding cache directories / files
            ...cache.paths.map(
              (p) =>
                `${LOCAL_CI_DIR}/${p}:${
                  p.startsWith("/") ? p : workdir + "/" + p
                }${cache.policy === "pull" ? ":ro" : ""}`
            ),
            // binding artifacts directories / files
            ...artifactsFiles.map(
              (p) =>
                `${LOCAL_CI_DIR}/${p}:${
                  p.startsWith("/") ? p : workdir + "/" + p
                }${job.artifacts?.paths?.includes(p) ? "" : ":ro"}`
            ),
          ],
        },
      };

      let container = null;

      try {
        container = await docker.createContainer(config);
      } catch (err) {
        await onerror(err);
      }

      try {
        await container.start();
      } catch (err) {
        await onerror(err, container);
      }

      try {
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

        // stopping container when finishing
        await container.stop();
      } catch (err) {
        await onerror(err, container);
      }

      const duration = ((performance.now() - now) / 1000).toFixed(2);
      console.log(chalk.green("✓"), ` - ${name} (${duration}s)\n`);
    }
  }
}

if (ARGV.help || ARGV.h) {
  console.log(`glci: Ease GitLab CI Pipelines set-up by running your jobs locally in Docker containers.

glci options:
    --only-jobs [jobs]: limiting the jobs to run to the comma-separated list of jobs name given
    -h:                 display this help message

Disclaimer: this is a helper tool aiming to facilite the process of setting up GitLab CI Pipelines. glci **does NOT** aim to replace any other tool.
`);
} else {
  main();
}
