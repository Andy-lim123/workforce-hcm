import { handleHrms } from "../handler";
import { loadDepartments } from "../data";

// GET only: other methods get 405 from Next.js. See HRMS_API.md.
export async function GET(request: Request) {
  return handleHrms(request, "departments", loadDepartments);
}
