import { POST as actionsPOST } from "../actions/route";

export const maxDuration = 60;

export async function POST(req: Request) {
  return actionsPOST(req as any);
}
