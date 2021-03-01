const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs-extra");

const ARGV = yargs(hideBin(process.argv)).argv;

const ONLY_JOBS = ARGV["only-jobs"]?.split
  ? ARGV["only-jobs"].split(",")
  : undefined;

const DOTENV_PATH = path.resolve(process.cwd(), ".env");
const ENV = fs.existsSync(DOTENV_PATH)
  ? dotenv.parse(fs.readFileSync(DOTENV_PATH))
  : {};

const GLCI_BASE = ARGV.dir ?? ".glci";

const GLCI_DIR = path.resolve(process.cwd(), GLCI_BASE);
const GLCI_CACHE_DIR = path.join(GLCI_DIR, ".glci_cache");
const GLCI_ARTIFACTS_DIR = path.join(GLCI_DIR, ".glci_artifacts");

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

const DEFAULT_STAGES = ["build", "test", "deploy"];

module.exports = {
  ARGV,
  ONLY_JOBS,
  DOTENV_PATH,
  ENV,
  GLCI_BASE,
  GLCI_DIR,
  GLCI_CACHE_DIR,
  GLCI_ARTIFACTS_DIR,
  RESERVED_JOB_NAMES,
  GLOBAL_DEFAULT_KEY,
  DEFAULT_STAGES,
};
