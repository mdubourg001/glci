import { babel } from "@rollup/plugin-babel";
import commonjs from "@rollup/plugin-commonjs";
import shebang from "rollup-plugin-preserve-shebang";

const config = {
  input: "index.js",
  output: {
    file: "dist/cli.min.js",
    format: "cjs",
  },
  plugins: [
    shebang(),
    commonjs(),
    babel({
      babelHelpers: "bundled",
      plugins: [
        "@babel/plugin-proposal-nullish-coalescing-operator",
        "@babel/plugin-proposal-optional-chaining",
      ],
    }),
  ],
};

export default config;
