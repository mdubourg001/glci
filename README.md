# glci 🦊

Ease GitLab CI Pipelines set-up by running your jobs locally in Docker containers.

Why ? Because I did not wanted to commit, push, and wait for my jobs to run on the GitLab UI to figure I forgot to install `make` before running `make build`.

📣 Disclaimer: this is a helper tool aiming to facilite the process of setting up GitLab CI Pipelines. glci **does NOT** aim to replace any other tool.

## Installation

```bash
yarn global add glci
```

## Usage

At the root of your project (where your `.gitlab-ci.yml` is):

```bash
glci
```

## Options

### `--only-jobs [jobs]`

Limiting the jobs to run to the comma-separated list of jobs name given. Handy when setting up that stage-three job depending on that first-stage job artifacts.

Example:

```bash
glci --only-jobs=install,test:e2e

# "build" and "test:unit" won't be ran here
#
# -----------     ---------     -------------
# | install | --- | build | --- | test:unit |
# -----------     ---------  |  -------------
#                            |
#                            |   ------------
#                            --- | test:e2e |
#                                ------------
```

## Cool stuff

- If a `.env` file exists next to your `.gitlab-ci.yml`, variables inside it get automatically parsed and added to the containers
- Most of the pre-defined environment variables normally set by GitLab CI are also set here: see [pre-defined.js](/pre-defined.js)

## How does it work ?

It's pretty straightforward:

- it parses your `.gitlab-ci.yml` file (and its "includes")
- it runs each job of each stage (serially) in a Docker container created on the fly using the right image
- it logs the results in the console
- it shares the `cache` and the `artifacts` between jobs using Docker volumes
- it automatically stops and removes the containers and the volumes created

## Roadmap

- Find a way to bind single files (not dirs) with volumes (need to figure out how)
- Handle glob in `cache:paths` and `artifacts:paths` (need to figure out how)
- Handle `artifacts:untracked` and `cache:untracked` (need to figure out how)
- Add `--env` to allow defining / overriding env variables
- Add `--in-vagrant` to run docker in Vagrant (not faster even on Mac for what I've tried)
- Prevent sharing artifacts between same-stage jobs
