"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setActiveClient } from "@/app/(platform)/_lib/active-client-actions";

export function SwitchOrganizationButton({ clientId, name }: { clientId: string; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setActiveClient(clientId);
          if (result.ok) window.location.assign("/dashboard");
          else toast.error(result.error);
        })
      }
    >
      {name}
    </Button>
  );
}
