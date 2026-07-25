import { createProductionPairingHandlers, productionPairingFailure } from "../../../../lib/server/pairing-runtime";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try { return await createProductionPairingHandlers().deleteDevice(request, context); }
  catch (error) { return productionPairingFailure(error); }
}
