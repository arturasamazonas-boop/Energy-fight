import { validateConfig } from "../shared/src/index.ts";
const errors = validateConfig();
if (errors.length) {
  console.error("Config errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("game config OK");
