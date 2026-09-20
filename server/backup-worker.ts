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
  try {
    const [command, source, destination] = Bun.argv.slice(2);
    if (!source || (command !== "inspect" && command !== "snapshot")) throw new Error("Usage: backup-worker.ts inspect FILE | snapshot SOURCE DESTINATION");
    if (command === "snapshot") {
      if (!destination) throw new Error("A snapshot destination is required");
      await writeBackupSnapshot(source, destination);
    }
    console.log(JSON.stringify(await inspectBackup(command === "snapshot" ? destination! : source)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
