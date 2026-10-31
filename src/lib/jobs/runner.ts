// Register every task handler so drainTasks can run them, whichever entry point calls it.
import "@/lib/referee/evaluate";
import { settleExpiredWindow } from "./settle";
import { registerTask } from "./tasks";

// A closed window's verdict must execute eventually, so settling never gives up.
registerTask("settle", settleExpiredWindow, undefined, { maxAttempts: Infinity });

export { drainTasks } from "./tasks";
