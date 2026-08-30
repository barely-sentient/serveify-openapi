export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          rootDir: ".",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          isolatedModules: true,
          esModuleInterop: true,
          skipLibCheck: true,
          downlevelIteration: true,
          target: "ES2022",
        },
      },
    ],
  },
  transformIgnorePatterns: [],
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
};
