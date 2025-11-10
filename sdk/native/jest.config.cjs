const config = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  preset: "ts-jest/presets/default-esm",
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", {
      useESM: true,
      tsconfig: {
        module: "ES2022",
        target: "ES2022",
        moduleResolution: "node",
      },
    }],
  },
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.mjs$": "$1",
    "^(\\.{1,2}/.*)\\.ts$": "$1",
  },
};

module.exports = config;
