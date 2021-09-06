const fs = require("fs");
const path = require("path");

const DOCKER_CONFIG = process.env.DOCKER_CONFIG || "~/.docker";

const DOCKER_CONFIG_ENVS = {};

function appendEnv(value, keys) {
  for (const key of keys) {
    DOCKER_CONFIG_ENVS[key] = value;
  }
}

const dockerConfigJsonPath = path.join(DOCKER_CONFIG, "config.json");
if (fs.existsSync(dockerConfigJsonPath)) {
  const dockerConfig = JSON.parse(fs.readFileSync(dockerConfigJsonPath, {
    encoding: "utf-8"
  }));
  if (dockerConfig.proxies && dockerConfig.proxies.default) {
    const defaultProxy = dockerConfig.proxies.default;
    if (defaultProxy.httpProxy) {
      appendEnv(defaultProxy.httpProxy, ["http_proxy", "HTTP_PROXY"]);
    }
    if (defaultProxy.httpsProxy) {
      appendEnv(defaultProxy.httpProxy, ["https_proxy", "HTTPS_PROXY"]);
    }
    if (defaultProxy.ftpProxy) {
      appendEnv(defaultProxy.httpProxy, ["ftp_proxy", "FTP_PROXY"]);
    }
    if (defaultProxy.noProxy) {
      appendEnv(defaultProxy.httpProxy, ["no_proxy", "NO_PROXY"]);
    }
  }
}

module.exports = {
  DOCKER_CONFIG_ENVS
};
