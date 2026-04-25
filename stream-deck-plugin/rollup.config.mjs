import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.dayglance.streamdeck.sdPlugin/bin/plugin.js",
    format: "cjs",
    sourcemap: true,
  },
  plugins: [
    resolve({ browser: false }),
    commonjs(),
    typescript({
      tsconfig: "./tsconfig.json",
      // rootDir must span both src/ and ../../electron/ to allow the cross-package
      // protocol import without a TypeScript rootDir violation during bundling.
      rootDir: "../..",
    }),
  ],
  external: [],
};
