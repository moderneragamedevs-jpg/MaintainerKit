#!/usr/bin/env node
import { createContext } from "./context.js";
import { runCli } from "./program.js";

const result = await runCli(process.argv.slice(2), createContext());
process.exitCode = result.exitCode;
