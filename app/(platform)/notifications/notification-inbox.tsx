"use client";

import Link from "next/link";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";

type Item = {
  _id: string;
  clientName: string | null;
  event: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: number;
};

export function NotificationInbox() {
  const items = useAuthedQuery(anyApi.notifications.listMine, {}) as Item[] | undefined;
  const markRead = useMutation(anyApi.notifications.markRead);

  if (items === undefined) return <Skeleton className="h-64 w-full" />;
  if (items.length === 0) return <Card className="p-6 border-dashed text-sm text-muted-foreground">No notifications yet.</Card>;
  const unread = items.filter((item) => !item.read).length;

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <p className="text-sm text-muted-foreground">{unread ? `${unread} unread` : "All read"}</p>
        <Button type="button" size="sm" variant="outline" disabled={!unread} onClick={() => void markRead({})}>
          <CheckCheck className="mr-1.5 h-4 w-4" /> Mark all read
        </Button>
      </div>
      <ul className="divide-y">
        {items.map((item) => {
          const content = (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className={`text-sm ${item.read ? "text-foreground" : "font-semibold text-foreground"}`}>
                  {!item.read ? <span className="mr-2 inline-block h-2 w-2 rounded-full bg-primary align-middle" aria-label="Unread" /> : null}
                  {item.title}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  <ClientDate value={item.createdAt} format="PPp" />
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
              {item.clientName ? <p className="mt-1 text-xs text-muted-foreground">{item.clientName}</p> : null}
            </>
          );
          return (
            <li key={item._id}>
              {item.link ? (
                <Link href={item.link} className="block px-5 py-3 hover:bg-muted/50" onClick={() => !item.read && void markRead({ notificationIds: [item._id] })}>
                  {content}
                </Link>
              ) : (
                <button type="button" className="block w-full px-5 py-3 text-left hover:bg-muted/50" onClick={() => !item.read && void markRead({ notificationIds: [item._id] })}>
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
