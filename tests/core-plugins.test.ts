import { jest } from "@jest/globals";

// Mock tinyglobby and os before importing core-plugins, same as use-glob tests
const mockGlob = jest.fn();
const mockPlatform = jest.fn(() => "linux");

jest.unstable_mockModule("tinyglobby", () => ({
  glob: mockGlob,
}));

jest.unstable_mockModule("os", () => ({
  default: { platform: mockPlatform },
}));

const { useGlobLoader } = await import("../src/core-plugins/use-glob.js");
const { useCustomHandlers } = await import("../src/core-plugins/use-custom-handlers.js");
const { useEventify } = await import("../src/core-plugins/use-eventify.js");
const { usePermissify } = await import("../src/core-plugins/use-permissify.js");

describe("core-plugins", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGlob.mockReset();
    mockPlatform.mockReturnValue("linux");
    mockGlob.mockResolvedValue([]);
  });

  describe("useCustomHandlers", () => {
    it("should be a ServerPlugin with beforeRouting", () => {
      expect(useCustomHandlers).toHaveProperty("beforeRouting");
      expect(typeof (useCustomHandlers as any).beforeRouting).toBe("function");
    });

    it("should glob for .handler.ts files", async () => {
      await (useCustomHandlers as any).beforeRouting();
      expect(mockGlob).toHaveBeenCalledWith(["./**/*.handler.ts", "!**/*.test.ts"], {
        expandDirectories: true,
        onlyFiles: true,
      });
    });

    it("should be created via useGlobLoader with correct pattern", async () => {
      // Re-import useGlobLoader to verify pattern? Instead verify behavior matches useGlobLoader
      const expected = useGlobLoader("./**/*.handler.ts");
      // Both should have same glob pattern behavior
      mockGlob.mockClear();
      await (expected as any).beforeRouting();
      const expectedCall = mockGlob.mock.calls[0];
      mockGlob.mockClear();
      await (useCustomHandlers as any).beforeRouting();
      const actualCall = mockGlob.mock.calls[0];
      expect(actualCall).toEqual(expectedCall);
    });
  });

  describe("useEventify", () => {
    it("should be a ServerPlugin with beforeRouting", () => {
      expect(useEventify).toHaveProperty("beforeRouting");
      expect(typeof (useEventify as any).beforeRouting).toBe("function");
    });

    it("should glob for .events.ts files", async () => {
      await (useEventify as any).beforeRouting();
      expect(mockGlob).toHaveBeenCalledWith(["./**/*.events.ts", "!**/*.test.ts"], {
        expandDirectories: true,
        onlyFiles: true,
      });
    });

    it("should match useGlobLoader factory for events pattern", async () => {
      const expected = useGlobLoader("./**/*.events.ts");
      mockGlob.mockClear();
      await (expected as any).beforeRouting();
      const expectedCall = mockGlob.mock.calls[0];
      mockGlob.mockClear();
      await (useEventify as any).beforeRouting();
      expect(mockGlob.mock.calls[0]).toEqual(expectedCall);
    });
  });

  describe("usePermissify", () => {
    it("should be a ServerPlugin with beforeRouting", () => {
      expect(usePermissify).toHaveProperty("beforeRouting");
      expect(typeof (usePermissify as any).beforeRouting).toBe("function");
    });

    it("should glob for .permissions.ts files", async () => {
      await (usePermissify as any).beforeRouting();
      expect(mockGlob).toHaveBeenCalledWith(["./**/*.permissions.ts", "!**/*.test.ts"], {
        expandDirectories: true,
        onlyFiles: true,
      });
    });

    it("should match useGlobLoader factory for permissions pattern", async () => {
      const expected = useGlobLoader("./**/*.permissions.ts");
      mockGlob.mockClear();
      await (expected as any).beforeRouting();
      const expectedCall = mockGlob.mock.calls[0];
      mockGlob.mockClear();
      await (usePermissify as any).beforeRouting();
      expect(mockGlob.mock.calls[0]).toEqual(expectedCall);
    });
  });

  describe("module re-exports (static check)", () => {
    it("should have index.ts re-exporting expected symbols", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("src/index.ts", "utf-8");
      expect(content).toContain("createHttpServer");
      expect(content).toContain("registerEndpointHandler");
      expect(content).toContain("useCustomHandlers");
      expect(content).toContain("useEventify");
      expect(content).toContain("useGlobLoader");
      expect(content).toContain("usePermissify");
    });
  });
});
