import type { DeviceRouteContext } from "../../../../lib/server/pairing-routes";
import { createProductionPairingHandlers, productionPairingFailure } from "../../../../lib/server/pairing-runtime";

export async function DELETE(request: Request, context: DeviceRouteContext): Promise<Response> {
  try { return await createProductionPairingHandlers().deleteDevice(request, context); }
  catch (error) { return productionPairingFailure(error); }
}
