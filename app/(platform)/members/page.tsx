import { redirect } from "next/navigation";

// Team management moved to Settings → Team, where a client's own Admin (and
// DeepTrack's internal admins) manage members and invitations.
export default function MembersPage() {
  redirect("/settings/team");
}
