"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { toast } from "sonner";
import { Loader2, MailPlus, UserMinus, UserCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { Field, Section, SettingsLoading, SettingsUnavailable, inputClass } from "@/components/settings/kit";
import { inviteTeamMember, revokeTeamInvite } from "./actions";

type Role = "client_admin" | "reviewer" | "compliance_analyst" | "developer" | "viewer";

const ROLES: Array<{ value: Role; label: string; who: string; can: string }> = [
  { value: "client_admin", label: "Admin", who: "CRO, Head of Compliance", can: "Everything: team, rules, security, API keys, billing, and any case decision." },
  { value: "reviewer", label: "Reviewer", who: "Senior compliance officer, MLRO", can: "Everything an Analyst can, plus final approval of cases your rules reserve for senior staff." },
  { value: "compliance_analyst", label: "Analyst", who: "Compliance analyst", can: "Run checks, investigate, add notes, decide standard cases and recommend decisions on the rest." },
  { value: "developer", label: "Developer", who: "IT / integration", can: "API keys, webhooks and test mode. Can run checks; doesn't review cases." },
  { value: "viewer", label: "Viewer / Auditor", who: "Internal audit, regulator visit", can: "Read-only: cases, reports and the audit log, with export." },
];
const ROLE_LABEL = Object.fromEntries(ROLES.map((role) => [role.value, role.label])) as Record<Role, string>;

const QUEUES = [
  { value: "kyc", label: "KYC" },
  { value: "aml", label: "AML" },
  { value: "idp", label: "IDP" },
  { value: "kyb", label: "KYB" },
  { value: "liveness", label: "Liveness" },
];

type Overview = {
  currentUserId: string;
  seats: { used: number; active: number; pending: number; limit: number | null };
  allowedEmailDomains: string[];
  members: Array<{
    _id: string;
    userId: string;
    name: string | null;
    email: string | null;
    role: Role;
    isActive: boolean;
    queues: string[];
    createdAt: number;
    lastSeenAt: number | null;
    deactivatedAt: number | null;
    casesHandled: number;
    outsideAllowedDomains: boolean;
  }>;
  invites: Array<{ _id: string; email: string; role: Role; invitedByName: string | null; emailStatus: "sent" | "failed" | null; createdAt: number; expiresAt: number }>;
};

export function TeamView({ clientId, isAdmin }: { clientId: string; isAdmin: boolean }) {
  if (!isAdmin) return <RolesGuide note="Only your organization's Admin can invite people and change roles. Ask them if you need access for someone." />;
  return <TeamAdmin clientId={clientId} />;
}

function RolesGuide({ note }: { note?: string }) {
  return (
    <Section title="Roles" description={note}>
      <div className="divide-y rounded-lg border">
        {ROLES.map((role) => (
          <div key={role.value} className="grid gap-1 p-3 text-sm sm:grid-cols-[160px_1fr]">
            <div>
              <p className="font-medium">{role.label}</p>
              <p className="text-xs text-muted-foreground">{role.who}</p>
            </div>
            <p className="text-muted-foreground">{role.can}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function TeamAdmin({ clientId }: { clientId: string }) {
  const data = useAuthedQuery(anyApi.team.overview, { clientId }) as Overview | null | undefined;
  if (data === undefined) return <SettingsLoading />;
  if (data === null) return <SettingsUnavailable />;
  const full = data.seats.limit !== null && data.seats.used >= data.seats.limit;
  return (
    <>
      <Section
        title="Invite a team member"
        description={`They get an email invitation and join the first time they sign in with that address.${
          data.allowedEmailDomains.length ? ` Only ${data.allowedEmailDomains.map((domain) => `@${domain}`).join(", ")} addresses can be invited.` : ""
        }`}
      >
        <SeatBar seats={data.seats} />
        <InviteForm clientId={clientId} disabled={full} />
      </Section>

      {data.invites.length > 0 ? (
        <Section title="Pending invitations" description="Invitations expire after 7 days. Inviting the same email again renews it.">
          <div className="divide-y rounded-lg border">
            {data.invites.map((invite) => (
              <PendingInvite key={invite._id} invite={invite} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Members" description="Change roles, choose which review queues people get cases from, or deactivate access. Deactivated members keep their history.">
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3">Member</th>
                <th className="p-3">Role</th>
                <th className="p-3">Review queues</th>
                <th className="p-3">Last seen</th>
                <th className="p-3 text-right">Cases</th>
                <th className="p-3 text-right">Access</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => (
                <MemberRow key={member._id} member={member} isMe={member.userId === data.currentUserId} />
              ))}
              {data.members.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    No members yet. Invite your team above.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Section>

      <RolesGuide />
    </>
  );
}

function SeatBar({ seats }: { seats: Overview["seats"] }) {
  if (seats.limit === null) {
    return <p className="text-sm text-muted-foreground">{seats.active} active member{seats.active === 1 ? "" : "s"} and {seats.pending} pending invitation{seats.pending === 1 ? "" : "s"}. Your plan has no seat limit.</p>;
  }
  const pct = Math.min(100, Math.round((seats.used / seats.limit) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Seats used (members + pending invitations)</span>
        <span className="font-medium">
          {seats.used} of {seats.limit}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted">
        <div className={`h-2 rounded-full ${pct >= 100 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      {pct >= 100 ? <p className="text-xs text-destructive">All seats are in use. Deactivate a member or ask DeepTrack for more seats.</p> : null}
    </div>
  );
}

function InviteForm({ clientId, disabled }: { clientId: string; disabled: boolean }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("compliance_analyst");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await inviteTeamMember(clientId, email, role);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setEmail("");
    if (result.emailSent) toast.success(`Invitation emailed to ${result.email}`);
    else toast.warning(`Invitation saved for ${result.email}. ${result.note ?? ""}`);
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
      <Field label="Email" htmlFor="invite-email">
        <input id="invite-email" type="email" className={inputClass} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@yourbank.co.ke" required disabled={disabled || pending} />
      </Field>
      <Field label="Role" htmlFor="invite-role">
        <select id="invite-role" className={inputClass} value={role} onChange={(event) => setRole(event.target.value as Role)} disabled={disabled || pending}>
          {ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" disabled={disabled || pending || !email.trim()}>
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}
        Invite
      </Button>
    </form>
  );
}

function PendingInvite({ invite }: { invite: Overview["invites"][number] }) {
  const [pending, setPending] = useState(false);
  async function revoke() {
    if (!window.confirm(`Revoke the invitation for ${invite.email}?`)) return;
    setPending(true);
    const result = await revokeTeamInvite(invite._id);
    setPending(false);
    if (result.ok) toast.success("Invitation revoked");
    else toast.error(result.error);
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
      <div>
        <p className="font-medium">{invite.email}</p>
        <p className="text-xs text-muted-foreground">
          {ROLE_LABEL[invite.role]} · invited {invite.invitedByName ? `by ${invite.invitedByName} ` : ""}
          <ClientDate value={invite.createdAt} format="PP" /> · expires <ClientDate value={invite.expiresAt} format="PP" />
        </p>
      </div>
      <div className="flex items-center gap-2">
        {invite.emailStatus === "failed" ? <Badge variant="outline" className="border-amber-300 text-amber-700">Email not sent</Badge> : invite.emailStatus === "sent" ? <Badge variant="outline">Email sent</Badge> : null}
        <Button type="button" size="sm" variant="outline" onClick={revoke} disabled={pending}>
          <X className="mr-1 h-3.5 w-3.5" /> Revoke
        </Button>
      </div>
    </div>
  );
}

function MemberRow({ member, isMe }: { member: Overview["members"][number]; isMe: boolean }) {
  const changeRole = useMutation(anyApi.team.changeRole);
  const setQueues = useMutation(anyApi.team.setQueues);
  const deactivate = useMutation(anyApi.team.deactivate);
  const reactivate = useMutation(anyApi.team.reactivate);
  const remove = useMutation(anyApi.team.remove);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
    } catch (error) {
      toast.error(getErrorMessage(error, "That change couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  const label = member.name ?? member.email ?? "Team member";
  const reviews = member.role === "client_admin" || member.role === "reviewer" || member.role === "compliance_analyst";
  return (
    <tr className={`border-b last:border-0 align-top ${member.isActive ? "" : "opacity-60"}`}>
      <td className="p-3">
        <p className="font-medium">
          {label}
          {isMe ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}
        </p>
        {member.email && member.name ? <p className="text-xs text-muted-foreground">{member.email}</p> : null}
        {member.outsideAllowedDomains ? <p className="text-xs text-amber-700">Outside your allowed email domains</p> : null}
        {!member.isActive ? (
          <p className="text-xs text-muted-foreground">
            Deactivated {member.deactivatedAt ? <ClientDate value={member.deactivatedAt} format="PP" /> : null}
          </p>
        ) : null}
      </td>
      <td className="p-3">
        <select
          aria-label={`Role for ${label}`}
          className={`${inputClass} py-1.5`}
          value={member.role}
          disabled={busy || !member.isActive}
          onChange={(event) => {
            const role = event.target.value as Role;
            void run(() => changeRole({ membershipId: member._id, role }), `${label} is now ${ROLE_LABEL[role]}`);
          }}
        >
          {ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      <td className="p-3">
        {reviews ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">{member.queues.length ? member.queues.map((queue) => QUEUES.find((item) => item.value === queue)?.label ?? queue).join(", ") : "All queues"}</summary>
            <div className="mt-2 space-y-1">
              {QUEUES.map((queue) => (
                <label key={queue.value} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    disabled={busy || !member.isActive}
                    checked={member.queues.includes(queue.value)}
                    onChange={(event) => {
                      const next = event.target.checked ? [...member.queues, queue.value] : member.queues.filter((item) => item !== queue.value);
                      void run(() => setQueues({ membershipId: member._id, queues: next }), "Review queues saved");
                    }}
                  />
                  {queue.label}
                </label>
              ))}
              <p className="text-xs text-muted-foreground">None ticked = all queues.</p>
            </div>
          </details>
        ) : (
          <span className="text-xs text-muted-foreground">Doesn&apos;t review</span>
        )}
      </td>
      <td className="p-3 text-muted-foreground">{member.lastSeenAt ? <ClientDate value={member.lastSeenAt} format="PP" /> : "Never"}</td>
      <td className="p-3 text-right">{member.casesHandled}</td>
      <td className="p-3">
        <div className="flex justify-end gap-2">
          {member.isActive ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || isMe}
              title={isMe ? "Another Admin must deactivate you" : undefined}
              onClick={() => {
                if (window.confirm(`Deactivate ${label}? They lose access right away; their open cases go back to the unassigned queue.`)) {
                  void run(() => deactivate({ membershipId: member._id }), `${label} deactivated`);
                }
              }}
            >
              <UserMinus className="mr-1 h-3.5 w-3.5" /> Deactivate
            </Button>
          ) : (
            <>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => reactivate({ membershipId: member._id }), `${label} reactivated`)}>
                <UserCheck className="mr-1 h-3.5 w-3.5" /> Reactivate
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove ${label} from the list? Their decisions and audit history are kept.`)) {
                    void run(() => remove({ membershipId: member._id }), `${label} removed`);
                  }
                }}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
