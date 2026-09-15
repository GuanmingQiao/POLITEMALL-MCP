#!/usr/bin/env node
import { login } from "./auth.js";

console.log("Opening a browser window — log in to POLITEMall as you normally would...");
await login();
console.log("Session captured and saved. You can close the browser window if it's still open.");
