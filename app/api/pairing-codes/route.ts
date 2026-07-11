import { createProductionPairingHandlers, productionPairingFailure } from "../../../lib/server/pairing-runtime";

export async function POST(request: Request): Promise<Response> {
  try { return await createProductionPairingHandlers().issue(request); }
  catch (error) { return productionPairingFailure(error); }
}
