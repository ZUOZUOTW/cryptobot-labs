import { createProductionPairingHandlers, productionPairingFailure } from "../../../../../lib/server/pairing-runtime";

export async function POST(request: Request): Promise<Response> {
  try { return await createProductionPairingHandlers().consume(request); }
  catch (error) { return productionPairingFailure(error); }
}
