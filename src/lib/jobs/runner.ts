// Register every task handler so drainTasks can run them, whichever entry point calls it.
import "@/lib/referee/evaluate";
import { settleExpiredWindow } from "./settle";
import { registerTask } from "./tasks";

registerTask("settle", settleExpiredWindow);

export { drainTasks } from "./tasks";
