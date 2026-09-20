import { Database } from "bun:sqlite";
import { chmod, lstat, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inspectBackup } from "./backup-validation";

export async function writeBackupSnapshot(source: string, destination: string): Promise<void> {
  const sourceFile = await lstat(source);
  if (!sourceFile.isFile()) throw new Error("Backup source must be an existing regular file");
  const sourcePath = await realpath(source);
  const destinationPath = resolve(await realpath(dirname(destination)), destination.split(/[\\/]/).at(-1) ?? "");
  if (sourcePath === destinationPath) throw new Error("Backup destination must differ from the source");
  try {
    await lstat(destinationPath);
    throw new Error("Backup destination already exists");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const database = new Database(sourcePath, { readonly: true, create: false });
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    database.query("VACUUM INTO ?").run(destinationPath);
  } finally {
    database.close();
  }
  await chmod(destinationPath, 0o600);
}

if (import.meta.main) {
  // Write the answer, then exit on a stated code.
  //
  // Everything waiting on this process is waiting on its pipes closing:
  // `backup.ts` spawns it for a snapshot, `verify-backup.ts` spawns it to
  // inspect a restored copy, and both read stdout to end of file. Setting
  // `process.exitCode` and falling off the end defers that to the event
  // loop draining, and this process opens SQLite. One handle outliving the
  // work turns a finished job into a process that never exits and a reader
  // that never sees the end — a hang, not a slow run, and intermittent
  // because it depends on what is still registered when the work ends.
  // That is what held CI for sixty seconds on 20 September 2026.
  let code = 0;
  try {
    const [command, source, destination] = Bun.argv.slice(2);
    if (!source || (command !== "inspect" && command !== "snapshot")) throw new Error("Usage: backup-worker.ts inspect FILE | snapshot SOURCE DESTINATION");
    if (command === "snapshot") {
      if (!destination) throw new Error("A snapshot destination is required");
      await writeBackupSnapshot(source, destination);
    }
    await Bun.write(Bun.stdout, `${JSON.stringify(await inspectBackup(command === "snapshot" ? destination! : source))}\n`);
  } catch (error) {
    await Bun.write(Bun.stderr, `${error instanceof Error ? error.message : String(error)}\n`);
    code = 1;
  }
  process.exit(code);
}
