#!/usr/bin/env node

const yaml = require("js-yaml");
const Docker = require("dockerode");
const git = require("nodegit");
const chalk = require("chalk");
const path = require("path");
const fs = require("fs-extra");
const slugify = require("slugify");
const { performance } = require("perf_hooks");
const { promisify } = require("util");
const osExec = promisify(require("child_process").exec);
const merge = require("deepmerge");

const define = require("./src/pre-defined");
const {
  getValidUrl,
  mkdirpRecSync,
  readdirRecSync,
  replaceEnvironmentVariables,
  drawPipeline,
} = require("./src/utils");
const {
  ARGV,
  ONLY_JOBS,
  ENV,
  GITLAB_CI_YML,
  GLCI_BASE,
  GLCI_DIR,
  GLCI_CACHE_DIR,
  GLCI_ARTIFACTS_DIR,
  RESERVED_JOB_NAMES,
  GLOBAL_DEFAULT_KEY,
  DEFAULT_STAGES,
} = require("./src/constants");

// ----- globals -----

const JOBS_NAMES = [];

const DEFAULT = {};

// ex: { 'test:e2e': { 'e2e/screenshots': '<GLCI_ARTIFACTS_DIR>/_test-e2e_e2e/screenshots' }  }
const ARTIFACTS = {};

// ----- main -----

async function execCommands({
  workdir,
  container,
  commands = [],
  onerror,
  verbose = true,
}) {
  const preparedCommands = typeof commands === "string" ? [commands] : commands;

  for (const command of preparedCommands) {
    if (verbose) {
      console.log(chalk.bold(chalk.green(command)));
    }

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
  if (!fs.existsSync(GITLAB_CI_YML)) {
    console.error(
      chalk.red(`Error while trying to read ${GITLAB_CI_YML}: file not found.`)
    );
    process.exit(1);
  }

  const gitlabci = fs.readFileSync(GITLAB_CI_YML, "utf8");
  let ci = null;

  try {
    ci = yaml.load(gitlabci);
    if (typeof ci !== "object") throw "";
  } catch {
    console.error(
      chalk.red(`Error while parsing ${GITLAB_CI_YML}: file is invalid.`)
    );
    process.exit(1);
  }

  // checking mandatory keys
  if (!("stages" in ci)) {
    ci.stages = DEFAULT_STAGES;
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
    console.error(chalk.red(err.stack));
    console.error("Docker daemon does not seem to be running.");
    process.exit(1);
  }

  // cleaning the .glci directory if asked
  if (ARGV.clean) {
    console.log(
      chalk.bold(`${chalk.blue("ℹ")} - Removing "${GLCI_BASE}"...\n`)
    );

    fs.removeSync(GLCI_DIR);
  }

  const repository = await git.Repository.open(".");
  const commit = await repository.getHeadCommit();
  const sha = commit.sha().slice(0, 7);

  const PROJECT_FILES_TEMP_DIR = path.join(GLCI_DIR, sha);

  const tree = await commit.getTree();
  const walker = tree.walk();
  let projectFiles = [];

  // listing .git project files
  walker.on("entry", (entry) => {
    const path = entry.path();

    if (fs.existsSync(path)) {
      projectFiles.push(path);
    }
  });
  walker.start();

  // adding .git to project files
  projectFiles.push(".git");

  // handling inclusion of other yaml files
  if ("include" in ci) {
    let included = "";

    for (const entry of ci.include) {
      if ("local" in entry) {
        included +=
          fs.readFileSync(path.join(process.cwd(), entry.local)) + "\n";
      } else {
        throw "Only 'local' includes are supported at the moment.";
      }
    }

    ci = { ...ci, ...yaml.load(included) };
  }

  // figuring out default values
  for (const key of GLOBAL_DEFAULT_KEY) {
    DEFAULT[key] = ci.default && ci.default[key] ? ci.default[key] : ci[key];
  }

  // diff. actual jobs from reserved "config" keys
  for (const key of Object.keys(ci).sort()) {
    if (!RESERVED_JOB_NAMES.includes(key)) {
      JOBS_NAMES.push(key);

      const job = ci[key];

      // handling extending hidden jobs
      if ("extends" in job) {
        const extend =
          typeof job.extends === "string" ? [job.extends] : job.extends;

        // checking that jobs to extend exist
        for (const hiddenJobName of extend) {
          if (!ci[hiddenJobName]) {
            await console.error(
              chalk.red(
                `Can't extend job '${hiddenJobName}': job doesn't exist.`
              )
            );
            process.exit(1);
          }
        }

        ci[key] = merge.all([...extend.map((name) => ci[name]), job], {
          arrayMerge: (_, other) => other,
        });
        delete ci[key].extends;
      }
    }
  }

  // draw the representation of the pipeline
  if (ARGV.draw !== false) {
    drawPipeline(ci, ONLY_JOBS);
  }

  // running stages by order of definition in the "stages" key
  for (const stage of ci.stages) {
    const jobs = JOBS_NAMES.filter((job) => (ci[job].stage ?? "test") === stage)
      .filter((job) => (ONLY_JOBS ? ONLY_JOBS.includes(job) : true))
      .filter((n) => !n.startsWith("."));

    let index = 0;

    // as default value for a job is "test"
    // see https://docs.gitlab.com/ee/ci/yaml/README.html#stages
    for (const name of jobs) {
      index++;

      const now = performance.now();
      let job = ci[name];

      const headline = `Running job "${chalk.yellow(name)}" for stage "${
        job.stage ?? "test"
      }"`;
      const delimiter = "-".repeat(headline.length);
      console.log(chalk.bold(delimiter));
      console.log(chalk.bold(headline));
      console.log(chalk.bold(delimiter + "\n"));

      const onerror = async (err, container) => {
        if (err) console.error(chalk.red(err.stack));
        console.error(chalk.red("✘"), ` - ${name}\n`);

        if (container) await container.stop();
        fs.removeSync(PROJECT_FILES_TEMP_DIR);
        process.exit(1);
      };

      const workdir = `/${sha}`;
      const image =
        (job.image?.name ? job.image.name : job.image) ??
        (DEFAULT.image?.name ? DEFAULT.image.name : DEFAULT.image) ??
        "ruby:2.5";
      const entrypoint =
        (job.image?.entrypoint ? job.image.entrypoint : undefined) ??
        (DEFAULT.image?.entrypoint ? DEFAULT.image.entrypoint : undefined);

      let cache = {};
      if ("cache" in job) {
        cache = {
          policy: job.cache.policy ?? "pull-push",
          paths: job.cache.paths ?? (Array.isArray(job.cache) ? job.cache : []),
          untracked: job.cache.untracked,
        };
      } else {
        cache = {
          policy: DEFAULT.cache?.policy ?? "pull-push",
          paths:
            DEFAULT.cache?.paths ??
            (Array.isArray(DEFAULT.cache) ? DEFAULT.cache : []),
          untracked: DEFAULT.cache?.untracked,
        };
      }

      const preDefined = await define({
        ...job,
        name,
        index,
        image,
        workdir,
      });
      let variables = {
        ...preDefined,
        ...ENV,
        ...DEFAULT.variables,
        ...job.variables,
      };

      let preparedImageName = image;
      try {
        // using credentials if needed
        let credentials = undefined;
        if (ENV.DOCKER_AUTH_CONFIG) {
          const dockerAuthConfig = JSON.parse(ENV.DOCKER_AUTH_CONFIG);

          const credentialsKey = Object.keys(dockerAuthConfig.auths ?? {}).find(
            (registry) => {
              const registryHost = new URL(getValidUrl(registry));
              const imageHost = new URL(getValidUrl(image));

              return registryHost.host === imageHost.host;
            }
          );

          if (credentialsKey) {
            const base64Creds = dockerAuthConfig.auths[credentialsKey].auth;
            const clearCreds = Buffer.from(base64Creds, "base64")
              .toString("utf-8")
              .split(":");

            credentials = {
              authconfig: {
                username: clearCreds[0],
                password: clearCreds.slice(1).join(":"),
                serveraddress: credentialsKey,
              },
            };
          }
        }

        // replacing environment variables in image name
        try {
          preparedImageName = replaceEnvironmentVariables(image, variables);
        } catch (e) {
          console.error(
            chalk.red(
              `When trying to replace environment variables in '${image}': ${e}`
            )
          );
          process.exit(1);
        }

        // updating the CI_JOB_IMAGE variable
        variables = {
          ...preDefined,
          CI_JOB_IMAGE: preparedImageName,
          ...ENV,
          ...DEFAULT.variables,
          ...job.variables,
        };

        // pulling the image to use
        await new Promise((resolve, reject) =>
          docker.pull(preparedImageName, credentials, (err, stream) => {
            if (err) {
              return reject(err);
            }

            let downloading = false;
            docker.modem.followProgress(
              stream,
              () => {
                if (!downloading) {
                  console.log(
                    chalk.bold(
                      `${chalk.blue(
                        "ℹ"
                      )} - Using existing image "${preparedImageName}"`
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
                      `${chalk.blue(
                        "ℹ"
                      )} - Pulling image "${preparedImageName}"...`
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

      // copying project files inside .glci to allow non-read-only bind (git clone)
      for (const file of projectFiles) {
        mkdirpRecSync(path.join(PROJECT_FILES_TEMP_DIR, path.dirname(file)));

        fs.copySync(
          `${path.resolve(process.cwd(), file)}`,
          path.join(PROJECT_FILES_TEMP_DIR, file),
          { recursive: true }
        );
      }

      // copying needed cache files in temp project files directory (pull cache)
      if (cache.policy !== "push") {
        for (const file of cache.paths) {
          const fileAbs = path.join(GLCI_CACHE_DIR, file);

          if (fs.existsSync(fileAbs)) {
            mkdirpRecSync(
              path.join(PROJECT_FILES_TEMP_DIR, path.dirname(file))
            );

            fs.copySync(fileAbs, path.join(PROJECT_FILES_TEMP_DIR, file), {
              recursive: true,
            });
          }
        }
      }

      // take only dependencies artifacts if exists else every artifact generated before
      let artifactsSources = job.dependencies ?? Object.keys(ARTIFACTS);

      // copying artifacts inside temp project files directory (pull artifacts)
      for (const jobName of artifactsSources) {
        for (const file of Object.keys(ARTIFACTS[jobName] ?? {})) {
          mkdirpRecSync(path.join(PROJECT_FILES_TEMP_DIR, path.dirname(file)));

          fs.copySync(
            `${ARTIFACTS[jobName][file]}`,
            path.join(PROJECT_FILES_TEMP_DIR, file),
            { recursive: true }
          );
        }
      }

      const config = {
        Image: preparedImageName,
        Entrypoint: entrypoint,
        Tty: true,
        Env: Object.keys(variables).map((key) => `${key}=${variables[key]}`),
        HostConfig: {
          AutoRemove: true,
          Binds: [`${PROJECT_FILES_TEMP_DIR}:${workdir}`],
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

          await execCommands({ workdir, container, commands, onerror });
        }

        // running script
        await execCommands({
          workdir,
          container,
          commands: job.script,
          onerror,
        });

        // running after_script
        if (job.after_script || DEFAULT.after_script) {
          const commands = job.after_script ?? DEFAULT.after_script;

          await execCommands({ workdir, container, commands, onerror });
        }

        // hack for linux: chown -R <workdir>/ inside container to fix root permissions
        // TODO: do other platforms need the hack ?
        if (process.platform === "linux") {
          const { stdout, stderr } = await osExec("id -u");

          if (stderr) {
            await onerror(stderr, container);
          } else if (stdout.trim()) {
            const commands = [`chown -R ${stdout.trim()}: ${workdir}`];
            await execCommands({
              workdir,
              container,
              commands,
              onerror,
              verbose: false,
            });
          }
        }

        // updating cache directory (if policy asks) after job ended
        if (cache.policy !== "pull") {
          const copyFiles = (files) => {
            for (const file of files) {
              const fileAbs = path.join(PROJECT_FILES_TEMP_DIR, file);
              const targetAbs = path.join(GLCI_CACHE_DIR, file);

              if (fs.existsSync(fileAbs)) {
                mkdirpRecSync(path.dirname(targetAbs));
                fs.copySync(fileAbs, targetAbs, { recursive: true });
              }
            }
          };

          if (cache.untracked === true) {
            const untracked = readdirRecSync(
              PROJECT_FILES_TEMP_DIR,
              [],
              "",
              projectFiles
            ).filter((file) => !projectFiles.includes(file));

            copyFiles(untracked);
          }

          copyFiles(cache.paths);
        }

        // updating artifacts directory after job ended
        if ("artifacts" in job) {
          ARTIFACTS[name] = {};

          const copyFiles = (files) => {
            for (const file of files) {
              const fileAbs = path.join(PROJECT_FILES_TEMP_DIR, file);
              const targetAbs = path.join(
                GLCI_ARTIFACTS_DIR,
                `${slugify(name)}_${file}`
              );

              if (fs.existsSync(fileAbs)) {
                mkdirpRecSync(path.dirname(targetAbs));
                fs.copySync(fileAbs, targetAbs, { recursive: true });
              }

              ARTIFACTS[name][file] = targetAbs;
            }
          };

          if (job.artifacts.untracked === true) {
            const untracked = readdirRecSync(
              PROJECT_FILES_TEMP_DIR,
              [],
              "",
              projectFiles
            ).filter((file) => !projectFiles.includes(file));

            copyFiles(untracked);
          }

          if (job.artifacts.paths) {
            copyFiles(job.artifacts.paths);
          }
        }

        // removing project files copy dir
        fs.removeSync(PROJECT_FILES_TEMP_DIR);

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

const version = require("./package.json").version;

if (ARGV.help || ARGV.h) {
  console.log(`glci (v${version}): Ease GitLab CI Pipelines set-up by running your jobs locally in Docker containers.

glci options:
    --only-jobs=[jobs]  limit the jobs to run to the comma-separated list of jobs name given
    --yml=<yml>         set the YAML file to use in place of .gitlab-ci.yml
    --dir=<dir>         change the directory where glci keeps cache and artifacts between jobs (default is ".glci")
    --clean             remove glci cache directory (see --dir) before running glci
    --no-draw           do not draw representation of the pipeline before running jobs
    -h                  display this help message

Disclaimer: this is a helper tool aiming to facilite the process of setting up GitLab CI Pipelines. glci **does NOT** aim to replace any other tool.
`);
} else if (process.env.NODE_ENV !== "test") {
  console.log(chalk.yellow(`glci (v${version})\n`));
  main();
}

module.exports = {
  glci: main,
};
