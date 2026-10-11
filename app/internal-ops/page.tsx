import { redirect } from "next/navigation";

// The sidebar links to /internal-ops; the ops overview is the landing screen.
export default function InternalOpsIndexPage() {
  redirect("/internal-ops/overview");
}
