#!/usr/bin/env node
// `npx politemall-mcp` entry point. Commands:
//   (none)         run the MCP server over stdio
//   setup          check prerequisites, register with MCP clients, sign in
//   auth           open the sign-in window now
//   auth --logout  delete everything stored on this computer
//   doctor         check that everything needed is in place
// POLITEMALL_HOST must be set before the server modules are loaded (they read it once), so they
// are imported dynamically below, after the Node version check.

const MIN_NODE = 22;
const major = Number(process.versions.node.split(".")[0]);
if (major < MIN_NODE) {
  console.error(`politemall-mcp needs Node.js ${MIN_NODE} or newer (this is ${process.versions.node}). Install a newer Node.js and try again.`);
  process.exit(1);
}
process.env.POLITEMALL_HOST = "local";

const HELP = `politemall-mcp: MCP server for POLITEMall and NYP, running on your computer.

Usage: npx -y @qiaoguanming/politemall-mcp@latest [command]

  (no command)    run the MCP server over stdio (what an MCP client launches)
  setup           check prerequisites, register with your MCP clients, sign in
  auth            open the sign-in window now
  auth --logout   delete the sign-in data stored on this computer
  doctor          check Node, browser, key storage, connectivity and sign-in
  --version       print the version
`;

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case undefined:
    await (await import("./run.js")).runStdio();
    break;
  case "auth":
  case "login":
  case "logout": {
    const commands = await import("./commands.js");
    process.exitCode = command === "logout" || rest.includes("--logout") ? await commands.logoutCommand() : await commands.authCommand();
    break;
  }
  case "doctor":
    process.exitCode = await (await import("./commands.js")).doctorCommand();
    break;
  case "setup":
    process.exitCode = await (await import("./setup.js")).setupCommand();
    break;
  case "--version":
  case "-v":
  case "version":
    console.log((await import("./commands.js")).packageVersion());
    break;
  case "--help":
  case "-h":
  case "help":
    console.log(HELP);
    break;
  default:
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    process.exitCode = 1;
}
