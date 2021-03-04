const mockfs = require("mock-fs");
const fs = require("fs");

const CWD = process.cwd();

function mockfsLoadCWD(filter) {
  let files = fs.readdirSync(CWD);

  if (filter) {
    files = files.filter(filter);
  }

  return files.reduce(
    (acc, file) => ({ ...acc, [file]: mockfs.load(file) }),
    {}
  );
}

module.exports = {
  CWD,
  mockfsLoadCWD,
};
