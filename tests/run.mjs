process.env.NODE_ENV = "test";
await import("./foundation.test.mjs");
await import("./io.test.mjs");
await import("./vision.test.mjs");
