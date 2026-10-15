"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { Flag, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";

// "Dispute this result" on a check's page: the team says why the pass or
// rejection is wrong, and DeepTrack reviews it (backend/convex/disputes.ts).

type Eligibility = {
  canDispute: boolean;
  reason: string | null;
  openDisputeId: string | null;
  disputedAt: number | null;
  disputeReason: string | null;
  verdict: string | null;
};

const MIN_REASON = 10;
const MAX_REASON = 2000;

export function DisputeButton({ verificationId }: { verificationId: string }) {
  const eligibility = useAuthedQuery(anyApi.disputes.eligibility, { verificationId }) as Eligibility | undefined;
  const openDispute = useMutation(anyApi.disputes.open);
  const withdraw = useMutation(anyApi.disputes.withdraw);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  if (!eligibility) return null;

  if (eligibility.openDisputeId) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/10 dark:text-amber-300">
        <Flag className="h-4 w-4" />
        <span>
          Disputed: DeepTrack is reviewing this result. <Link href="/disputes" className="underline">See disputes</Link>
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={saving}
          onClick={async () => {
            if (!window.confirm("Withdraw this dispute? The current result stays.")) return;
            setSaving(true);
            try {
              await withdraw({ reviewId: eligibility.openDisputeId });
              toast.success("Dispute withdrawn");
            } catch (error) {
              toast.error(getErrorMessage(error, "Couldn't withdraw the dispute."));
            } finally {
              setSaving(false);
            }
          }}
        >
          Withdraw
        </Button>
      </div>
    );
  }

  if (!eligibility.canDispute) return null;
  const expected = eligibility.verdict === "pass" ? "reject" : "pass";
  const trimmed = reason.trim();

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
        <Flag className="mr-1.5 h-4 w-4" /> Dispute this result
      </Button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispute this result</DialogTitle>
            <DialogDescription>
              The check {eligibility.verdict === "pass" ? "passed" : "was rejected"}. If you think it should have{" "}
              {expected === "pass" ? "passed" : "been rejected"}, tell DeepTrack why. A DeepTrack reviewer decides, and your team is notified. The current
              result stands until then.
            </DialogDescription>
          </DialogHeader>
          <label className="block text-sm font-medium" htmlFor="dispute-reason">
            Why is the result wrong?
          </label>
          <textarea
            id="dispute-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, MAX_REASON))}
            rows={5}
            placeholder={
              expected === "pass"
                ? "e.g. The customer's ID was checked in branch; the name differs only by a middle name."
                : "e.g. We have evidence this document was altered."
            }
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            {trimmed.length}/{MAX_REASON}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={saving || trimmed.length < MIN_REASON}
              onClick={async () => {
                setSaving(true);
                try {
                  await openDispute({ verificationId, reason: trimmed, expectedVerdict: expected });
                  toast.success("Dispute sent to DeepTrack");
                  setDialogOpen(false);
                  setReason("");
                } catch (error) {
                  toast.error(getErrorMessage(error, "Couldn't send the dispute."));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Send dispute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
