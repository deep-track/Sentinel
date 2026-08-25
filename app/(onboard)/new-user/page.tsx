import { getCurrentUser } from "@/backend/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NewUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");

  // User provisioning is handled by the Convex customer-membership layer.
  // Do not call the removed legacy /api/users endpoint here; the platform
  // layout performs the fail-closed customer authorization check next.
  redirect("/dashboard");
}
