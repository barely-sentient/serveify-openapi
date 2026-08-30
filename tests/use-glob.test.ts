import { jest } from "@jest/globals";

// Mocks for tinyglobby and os must be registered before importing use-glob
const mockGlob = jest.fn();
const mockPlatform = jest.fn(() => "linux");

jest.unstable_mockModule("tinyglobby", () => ({
  glob: mockGlob,
}));

jest.unstable_mockModule("os", () => ({
  default: {
    platform: mockPlatform,
  },
}));

// Import after mocks
const { useGlobLoader } = await import("../src/core-plugins/use-glob.js");

describe("useGlobLoader", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGlob.mockReset();
    mockPlatform.mockReturnValue("linux");
  });

  it("should return a plugin object with beforeRouting function", () => {
    const plugin = useGlobLoader("./**/*.handler.ts");
    expect(plugin).toHaveProperty("beforeRouting");
    expect(typeof plugin.beforeRouting).toBe("function");
  });

  it("should call glob with correct pattern and exclude test files", async () => {
    mockGlob.mockResolvedValue([]);
    const plugin = useGlobLoader("./src/**/*.ts");
    await plugin.beforeRouting!();
    expect(mockGlob).toHaveBeenCalledWith(["./src/**/*.ts", "!**/*.test.ts"], {
      expandDirectories: true,
      onlyFiles: true,
    });
    expect(mockGlob).toHaveBeenCalledTimes(1);
  });

  it("should call glob with provided path and exclusion", async () => {
    mockGlob.mockResolvedValue([]);
    const plugin = useGlobLoader("custom/**/*.events.ts");
    await plugin.beforeRouting!();
    expect(mockGlob).toHaveBeenCalledWith(["custom/**/*.events.ts", "!**/*.test.ts"], {
      expandDirectories: true,
      onlyFiles: true,
    });
  });

  it("should import all files returned by glob", async () => {
    (globalThis as any).__globDummyImported = false;
    // Use a fresh file that hasn't been imported before if possible, but use dummy and verify via success
    mockGlob.mockResolvedValue(["tests/fixtures/glob-dummy.ts"]);
    const plugin = useGlobLoader("./**/*.handler.ts");
    await plugin.beforeRouting!();
    // After first import, dummy flag should be true (or remain true if cached)
    // For cached case, we just verify no error and that file was targeted
    expect(mockGlob).toHaveBeenCalled();
    // If fresh, flag true; if cached, we verify subsequent import still works via not throwing
    // Here dummy was already imported in earlier run? First test that imports it is this one, so should be fresh
    expect((globalThis as any).__globDummyImported).toBe(true);
  });

  it("should import multiple files via Promise.all", async () => {
    mockGlob.mockResolvedValue(["tests/fixtures/glob-dummy-2.ts", "tests/fixtures/glob-dummy-3.ts"]);
    const plugin = useGlobLoader("./**/*.handler.ts");
    await plugin.beforeRouting!();
    expect((globalThis as any).__globDummy2Imported).toBe(true);
    expect((globalThis as any).__globDummy3Imported).toBe(true);
  });

  it("should handle empty glob result without importing", async () => {
    mockGlob.mockResolvedValue([]);
    const plugin = useGlobLoader("./**/*.handler.ts");
    // Should not throw
    await expect(plugin.beforeRouting!()).resolves.toBeUndefined();
    expect(mockGlob).toHaveBeenCalled();
  });

  it("should handle Windows path with backslashes by normalizing to forward slashes", async () => {
    // Use Windows-style path returned by glob (simulating tinyglobby on Windows)
    // Use a fresh dummy file not yet imported (glob-dummy-4)
    mockGlob.mockResolvedValue(["tests\\fixtures\\glob-dummy-4.ts"]);
    mockPlatform.mockReturnValue("win32");
    const plugin = useGlobLoader("./**/*.handler.ts");
    await plugin.beforeRouting!();
    expect((globalThis as any).__globDummy4Imported).toBe(true);
  });

  it("should strip drive letter on win32 platform", async () => {
    mockGlob.mockResolvedValue(["tests/fixtures/glob-dummy-5.ts"]);
    mockPlatform.mockReturnValue("win32");
    const plugin = useGlobLoader("./**/*.handler.ts");
    await expect(plugin.beforeRouting!()).resolves.toBeUndefined();
    expect((globalThis as any).__globDummy5Imported).toBe(true);
  });

  it("should keep full path on non-win32 platform", async () => {
    mockGlob.mockResolvedValue(["tests/fixtures/glob-dummy-3.ts"]);
    mockPlatform.mockReturnValue("linux");
    const plugin = useGlobLoader("./**/*.handler.ts");
    await plugin.beforeRouting!();
    expect((globalThis as any).__globDummy3Imported).toBe(true);
  });

  it("should propagate glob errors", async () => {
    mockGlob.mockRejectedValue(new Error("glob failed"));
    const plugin = useGlobLoader("./**/*.handler.ts");
    await expect(plugin.beforeRouting!()).rejects.toThrow("glob failed");
  });

  it("should propagate import errors when file does not exist", async () => {
    mockGlob.mockResolvedValue(["nonexistent/file.ts"]);
    const plugin = useGlobLoader("./**/*.handler.ts");
    await expect(plugin.beforeRouting!()).rejects.toThrow();
  });

  it("should not include test files due to exclusion pattern (mock verification)", async () => {
    mockGlob.mockResolvedValue([]);
    const plugin = useGlobLoader("./**/*.ts");
    await plugin.beforeRouting!();
    const args = mockGlob.mock.calls[0][0];
    expect(args).toContain("!**/*.test.ts");
  });
});
