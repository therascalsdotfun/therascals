import { DatabaseSync } from "node:sqlite";
export function publicProcessLock(file = ".data/public-process.sqlite") {
  const db = new DatabaseSync(file);
  try {
    db.exec(
      "PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS guard (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE;",
    );
  } catch {
    db.close();
    throw Error(
      "Another public Jackpot process is using this volume. Run exactly one process/replica.",
    );
  }
  return () => {
    db.exec("ROLLBACK");
    db.close();
  };
}
