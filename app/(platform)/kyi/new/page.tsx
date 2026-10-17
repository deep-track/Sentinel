import { redirect } from "next/navigation";

// KYI has been retired. Identity documents and proof of address are now
// verified in IDP.
export default function NewKYIPage() {
  redirect("/idp");
}
