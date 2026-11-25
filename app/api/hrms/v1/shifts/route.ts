import { handleHrms } from "../handler";
import { loadShifts } from "../data";

// GET only: other methods get 405 from Next.js. See HRMS_API.md.
export async function GET(request: Request) {
  return handleHrms(request, "shifts", loadShifts);
}
