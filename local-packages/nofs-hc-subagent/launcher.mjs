// Runs inside the child terminal: node launcher.mjs <job.json>
// `hc run` cannot set environment variables, so the job file holds
// { command, args, env }. Spawning with an argv array from the file keeps a
// task with newlines, quotes or non-ASCII text intact.
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const jobPath = process.argv[2];
const job = JSON.parse(readFileSync(jobPath, "utf8"));
rmSync(jobPath, { force: true });

const child = spawn(job.command, job.args, { stdio: "inherit", env: { ...process.env, ...job.env } });
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
	console.error(String(error));
	process.exit(1);
});
