import { verifyExchangePair } from "./verify-exchange.js";

const [evidencePath, manifestPath, expectedAuthorizationRef] = process.argv.slice(2);
if (!evidencePath || !manifestPath || !expectedAuthorizationRef) throw new Error("usage: evidence:verify <evidence-path> <manifest-path> <expected-authorization-ref>");
process.stdout.write(`${JSON.stringify(await verifyExchangePair({ evidencePath, manifestPath, expectedAuthorizationRef }))}\n`);
