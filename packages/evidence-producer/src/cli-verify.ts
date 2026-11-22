import { verifyExchangePair } from "./verify-exchange.js";

const [evidencePath, manifestPath] = process.argv.slice(2);
if (!evidencePath || !manifestPath) throw new Error("usage: evidence:verify <evidence-path> <manifest-path>");
process.stdout.write(`${JSON.stringify(await verifyExchangePair({ evidencePath, manifestPath }))}\n`);
