// Import every task handler so drainTasks can run them, whichever entry point calls it.
import "@/lib/referee/evaluate";

export { drainTasks } from "./tasks";
