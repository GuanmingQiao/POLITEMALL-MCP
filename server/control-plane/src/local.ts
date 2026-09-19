// Runs the exact same server (same tools, same routes) on your own machine, with no AWS: the
// master key is generated into ./data next to the token store and PUBLIC_ORIGIN defaults to
// http://localhost:PORT. Start it with `npm run local`.
process.env.LOCAL_MODE = "1";
await import("./index.js");
