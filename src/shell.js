// References:
// * https://gitlab.com/gitlab-org/gitlab-runner/-/blob/master/shells/bash.go
// * https://gitlab.com/gitlab-org/gitlab-runner/-/blob/master/executors/shell/shell.go

/**
 * get bash detect shell script
 *
 * @param isLoginShell {boolean} login shell
 * @return {string} generated code
 */
function getBashDetectShellScript(isLoginShell) {
  const bashDefaultArguments = isLoginShell ? '--login' : '';
  return `if [ -x /usr/local/bin/bash ]; then
	exec /usr/local/bin/bash ${bashDefaultArguments} "$@"
elif [ -x /usr/bin/bash ]; then
	exec /usr/bin/bash ${bashDefaultArguments} "$@"
elif [ -x /bin/bash ]; then
	exec /bin/bash ${bashDefaultArguments} "$@"
elif [ -x /usr/local/bin/sh ]; then
	exec /usr/local/bin/sh "$@"
elif [ -x /usr/bin/sh ]; then
	exec /usr/bin/sh "$@"
elif [ -x /bin/sh ]; then
	exec /bin/sh "$@"
elif [ -x /busybox/sh ]; then
	exec /busybox/sh "$@"
else
	echo shell not found
	exit 1
fi
`;
}

function getShellCommandLine(userCommand) {
  const command = [
    'sh', '-c', getBashDetectShellScript(true)
  ];
  if (userCommand) {
    command.push('--');
    command.push('-c');
    command.push(userCommand);
  }
  return command;
}


module.exports = {
  getShellCommandLine
};
