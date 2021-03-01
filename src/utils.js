const fs = require("fs-extra");
const chalk = require("chalk");

const { RESERVED_JOB_NAMES } = require("./constants");

function getValidUrl(url) {
  const newUrl = decodeURIComponent(url).trim().replace(/\s/g, "");

  if (/^(:\/\/)/.test(newUrl)) {
    return `http${newUrl}`;
  }

  if (!/^(f|ht)tps?:\/\//i.test(newUrl)) {
    return `http://${newUrl}`;
  }

  return newUrl;
}

function mkdirpRecSync(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function drawPipeline(ci, onlyJobs) {
  // [[ "test", [ "test:unit", "test:e2e" ] ], [ "build", "build:staging" ]]
  const rows = [];
  const pipelineJobs = Object.keys(ci)
    .filter((key) => !RESERVED_JOB_NAMES.includes(key))
    .filter((key) => !key.startsWith("."))
    .map((key) => ({ ...ci[key], name: key }));

  let stageCount = 0;
  for (const stage of ci.stages ?? DEFAULT_STAGES) {
    rows[stageCount] = [stage];

    const stageJobs = pipelineJobs.filter(
      (job) => (job.stage ?? "test") === stage
    );

    rows[stageCount][1] = stageJobs.map((job) => job.name);
    stageCount++;
  }

  const titles = [];

  for (let stage = 0; stage < rows.length; stage++) {
    const longestName = Math.max(
      ...[...rows[stage][1], rows[stage][0]].map((j) => j.length)
    );

    const spaces = longestName + 6 - rows[stage][0]?.length;
    titles.push(" ".repeat(Math.floor(spaces / 2)));
    titles.push(rows[stage][0]);
    titles.push(" ".repeat(Math.ceil(spaces / 2)));
    stage + 1 < rows.length && titles.push(" ".repeat(5));
  }

  console.log(chalk.grey("\n" + titles.join("")));
  console.log(chalk.grey("-".repeat(titles.join("").length)));

  for (
    let job = 0;
    job < Math.max(...rows.map((row) => row[1].length));
    job++
  ) {
    const border = [];
    const content = [];

    for (let stage = 0; stage < rows.length; stage++) {
      const longestName = Math.max(
        ...[...rows[stage][1], rows[stage][0]].map((j) => j.length)
      );
      const jobName = rows[stage][1][job];

      if (jobName) {
        let _ = chalk.bold;

        if (onlyJobs && !onlyJobs.includes(jobName)) {
          _ = chalk.grey;
        }

        border.push(_("|"));
        border.push(_("-").repeat(longestName + 4));
        border.push(_("|"));
        stage + 1 < rows.length && border.push(" ".repeat(5));

        content.push(_("|"));
        const spaces = longestName + 4 - jobName?.length;
        content.push(" ".repeat(Math.floor(spaces / 2)));
        content.push(_(jobName));
        content.push(" ".repeat(Math.ceil(spaces / 2)));
        content.push(_("|"));
        stage + 1 < rows.length && content.push(" ".repeat(5));
      } else {
        const spaces = " ".repeat(
          longestName + 6 + (stage + 1 < rows.length ? 5 : 0)
        );

        border.push(spaces);
        content.push(spaces);
      }
    }

    console.log(border.join(""));
    console.log(content.join(""));
    console.log(border.join("") + "\n");
  }
}

module.exports = {
  getValidUrl,
  mkdirpRecSync,
  drawPipeline,
};
